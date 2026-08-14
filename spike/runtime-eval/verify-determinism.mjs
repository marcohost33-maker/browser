#!/usr/bin/env node
// Determinism gate for the runtime-evaluation payload (ADR-006 spike).
//
// The payload is framework-neutral and byte-stable: the same asset bytes must
// be shipped to every candidate harness. jsdom is intentionally NOT a
// dependency (this repo is zero-runtime-dep), so this gate uses a pure SHA256
// asset-manifest check:
//
//   1. Recursively hash every file under payload/ (sorted, stable order).
//   2. Hash the whole set TWICE and confirm the two passes are byte-identical
//      (proves the hashing/enumeration itself is deterministic).
//   3. Compare against the committed asset-manifest.json.
//        --update  regenerates asset-manifest.json (use after intentional edits)
//        (default) verifies; exit 0 on full match, exit 1 on any mismatch.
//
// Zero dependencies: only node:crypto / node:fs / node:path.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD_DIR = join(HERE, 'payload');
const MANIFEST_PATH = join(HERE, 'asset-manifest.json');
const SCHEMA = 'runtime-eval-asset-manifest/v2';

// PR#42 P1: the byte lock used to cover payload/ only. assertions.json is the
// contract that decides which probe outcome counts as "expected" and therefore
// decides HARNESS_EXIT=0 — widening it (e.g. adding "FAIL" to a security
// probe's expected[]) produced green evidence against a manipulated contract
// while every payload hash still matched. Contract files are hashed here and
// re-checked in-process by the harness (harness-lib.verifyContractLock).
const CONTRACT_FILES = ['assertions.json'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (st.isFile()) out.push(full);
  }
  return out;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function buildManifest() {
  const files = walk(PAYLOAD_DIR).sort();
  const assets = {};
  for (const f of files) {
    // POSIX-style relative key so the manifest is stable across OSes.
    const key = relative(PAYLOAD_DIR, f).split(sep).join('/');
    assets[key] = sha256(readFileSync(f));
  }
  // Aggregate hash over "key:hash\n" lines in sorted order.
  const aggregate = sha256(
    Object.keys(assets).sort().map((k) => `${k}:${assets[k]}`).join('\n'),
  );
  const contracts = {};
  for (const name of [...CONTRACT_FILES].sort()) {
    const full = join(HERE, name);
    if (!existsSync(full)) fail(`contract file missing: ${full}`);
    contracts[name] = sha256(readFileSync(full));
  }
  return {
    schema: SCHEMA,
    algorithm: 'sha256',
    assetCount: Object.keys(assets).length,
    aggregate,
    assets,
    contracts,
  };
}

function stableStringify(m) {
  // Deterministic serialization: sorted asset keys, fixed field order.
  const assets = {};
  for (const k of Object.keys(m.assets).sort()) assets[k] = m.assets[k];
  const contracts = {};
  for (const k of Object.keys(m.contracts || {}).sort()) contracts[k] = m.contracts[k];
  return JSON.stringify(
    {
      schema: m.schema,
      algorithm: m.algorithm,
      assetCount: m.assetCount,
      aggregate: m.aggregate,
      assets,
      contracts,
    },
    null, 2,
  ) + '\n';
}

function fail(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exit(1);
}

function main() {
  if (!existsSync(PAYLOAD_DIR)) fail(`payload directory missing: ${PAYLOAD_DIR}`);

  // Step 1+2: hash twice, prove hashing determinism.
  const passA = buildManifest();
  const passB = buildManifest();
  if (passA.aggregate !== passB.aggregate) {
    fail(`non-deterministic hashing: ${passA.aggregate} != ${passB.aggregate}`);
  }
  process.stdout.write(`hashing deterministic across 2 passes: ${passA.aggregate}\n`);
  process.stdout.write(`assets hashed: ${passA.assetCount}\n`);

  const update = process.argv.includes('--update');
  if (update) {
    writeFileSync(MANIFEST_PATH, stableStringify(passA));
    process.stdout.write(`asset-manifest.json written (${passA.assetCount} assets)\n`);
    process.exit(0);
  }

  // Step 3: verify against committed manifest.
  if (!existsSync(MANIFEST_PATH)) {
    fail('asset-manifest.json missing — run with --update to generate it');
  }
  const committed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const problems = [];
  if (committed.aggregate !== passA.aggregate) {
    problems.push(`aggregate mismatch: committed ${committed.aggregate} != actual ${passA.aggregate}`);
  }
  const committedKeys = Object.keys(committed.assets || {}).sort();
  const actualKeys = Object.keys(passA.assets).sort();
  for (const k of actualKeys) {
    if (!(k in committed.assets)) problems.push(`new/untracked asset: ${k}`);
    else if (committed.assets[k] !== passA.assets[k]) {
      problems.push(`hash mismatch: ${k}\n    committed ${committed.assets[k]}\n    actual    ${passA.assets[k]}`);
    }
  }
  for (const k of committedKeys) {
    if (!(k in passA.assets)) problems.push(`missing asset (in manifest, not on disk): ${k}`);
  }

  // Contract lock: fail-closed. A manifest without a contracts section is an
  // OLD manifest and must not be accepted, otherwise the widening it is meant
  // to catch would simply pass through an absent hash.
  const committedContracts = committed.contracts;
  if (!committedContracts || typeof committedContracts !== 'object') {
    problems.push('asset-manifest.json has no "contracts" section — the assertion contract is unlocked');
  } else {
    for (const k of Object.keys(passA.contracts)) {
      if (!(k in committedContracts)) problems.push(`contract not locked in the manifest: ${k}`);
      else if (committedContracts[k] !== passA.contracts[k]) {
        problems.push(`contract hash mismatch: ${k}\n    committed ${committedContracts[k]}\n    actual    ${passA.contracts[k]}`);
      }
    }
    for (const k of Object.keys(committedContracts)) {
      if (!(k in passA.contracts)) problems.push(`contract in manifest is not verified: ${k}`);
    }
  }

  if (problems.length) {
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    fail(`${problems.length} determinism problem(s) — payload assets diverged from asset-manifest.json`);
  }

  process.stdout.write(`OK: ${actualKeys.length} assets byte-identical to asset-manifest.json\n`);
  process.stdout.write(`OK: ${Object.keys(passA.contracts).length} contract file(s) byte-identical: ${Object.keys(passA.contracts).join(', ')}\n`);
  process.stdout.write(`aggregate: ${passA.aggregate}\n`);
  process.exit(0);
}

main();
