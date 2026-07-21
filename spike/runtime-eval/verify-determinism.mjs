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
const SCHEMA = 'runtime-eval-asset-manifest/v1';

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
  return { schema: SCHEMA, algorithm: 'sha256', assetCount: Object.keys(assets).length, aggregate, assets };
}

function stableStringify(m) {
  // Deterministic serialization: sorted asset keys, fixed field order.
  const assets = {};
  for (const k of Object.keys(m.assets).sort()) assets[k] = m.assets[k];
  return JSON.stringify(
    { schema: m.schema, algorithm: m.algorithm, assetCount: m.assetCount, aggregate: m.aggregate, assets },
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

  if (problems.length) {
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
    fail(`${problems.length} determinism problem(s) — payload assets diverged from asset-manifest.json`);
  }

  process.stdout.write(`OK: ${actualKeys.length} assets byte-identical to asset-manifest.json\n`);
  process.stdout.write(`aggregate: ${passA.aggregate}\n`);
  process.exit(0);
}

main();
