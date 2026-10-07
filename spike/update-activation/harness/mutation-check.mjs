#!/usr/bin/env node
// Mutation check for the coupled update transaction: removes one control at a time and
// requires that at least one focused test fails. A control whose removal keeps every
// test green is not tested. Each focused test must pass on the unmutated source first,
// so a test that was already failing can never count as a kill. The source file is
// restored on exit, including on SIGINT/SIGTERM, and its digest is verified afterwards.
//
//   node spike/update-activation/harness/mutation-check.mjs
//
// Mutations are exact source substitutions. A mutation that no longer applies is
// reported as NOT-APPLIED and fails the run: the list must follow the code.
//
// Deliberately absent: controls the verifier enforces a second time on the same bytes
// (for example the per-file size gate before copying: the verifier's own gate rejects
// the copy, so no test can observe the earlier one). Their removal would survive by
// design; they are defense in depth, documented where they are written.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '..', '..', '..');
const source = path.join(here, '..', 'update-activation.js');
const tests = 'tests/update-activation/update-activation.test.js';

export const MUTATIONS = Object.freeze([
  {
    name: 'trust state is not checked against the bound targets',
    from: '  assertTrustStateAuthorised(trustState.app, chain.targets);\n',
    to: '',
    pattern: 'does not authorise',
  },
  {
    name: 'bound metadata is evaluated for freshness on load',
    from: 'const FRESHNESS_NOT_EVALUATED = new Date(0);',
    to: 'const FRESHNESS_NOT_EVALUATED = new Date();',
    pattern: 'expiry is evaluated',
  },
  {
    name: 'inputs are bound without a private copy',
    from: '  const copy = Buffer.alloc(byteLength);\n  copy.set(value);\n  return copy;',
    to: '  return value;',
    pattern: 'bytes that were verified',
  },
  {
    name: 'root chain length is not gated before copying',
    from: '  if (roots.length > rootUpdates) {',
    to: '  if (false) {',
    pattern: 'oversized inputs',
  },
  {
    name: 'a newer root is bound without re-verifying the bound chain',
    from: '    try {\n      verifyBoundChain(result.trustedState.root, state.raw, limits);\n    } catch (error) {',
    to: '    try {\n      void result;\n    } catch (error) {',
    pattern: 'newer root with an unchanged timestamp',
  },
  {
    name: 'a metadata-only update re-activates the package',
    from: "  if (result.status === 'metadata-updated') return { kind: 'bind', state, bindings, decision };\n",
    to: '',
    pattern: 'local rollback moves only the package',
  },
  {
    name: 'package and metadata are committed separately',
    from: '  const committed = await store.activate(versionId, { expectedGeneration, bindings: plan.bindings });',
    to: '  await store.commitBindings(plan.bindings, { expectedGeneration });\n'
      + '  const committed = await store.activate(versionId, { expectedGeneration: expectedGeneration + 1 });',
    pattern: 'exactly one commit',
  },
  {
    name: 'the commit does not compare-and-swap on the verified generation',
    from: '  const committed = await store.activate(versionId, { expectedGeneration, bindings: plan.bindings });',
    to: '  const committed = await store.activate(versionId, { expectedGeneration: (await store.status()).generation, bindings: plan.bindings });',
    pattern: 'concurrent commit',
  },
  {
    name: 'bootstrap merges a second root into existing trust',
    from: "  if (existing.length > 0) fail('UPDATE_TRUST_EXISTS'",
    to: "  if (false) fail('UPDATE_TRUST_EXISTS'",
    pattern: 'bootstrap binds one self-signed root',
  },
  {
    name: 'start-up accepts an active package newer than the trusted one',
    from: '  if (!current && !(target.appVersion < state.app.version)) {',
    to: '  if (false) {',
    pattern: 'did not authorise',
  },
  {
    name: 'start-up skips the integrity check of the active version',
    from: "  if (!integrity.ok) fail('ACTIVE_VERSION_INVALID'",
    to: "  if (false) fail('ACTIVE_VERSION_INVALID'",
    pattern: 'did not authorise',
  },
]);

const digest = (text) => createHash('sha256').update(text).digest('hex');

function runFocused(pattern) {
  return spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, tests], {
    cwd: repository,
    encoding: 'utf8',
  });
}

function main() {
  const original = readFileSync(source, 'utf8');
  const originalDigest = digest(original);
  const restore = () => writeFileSync(source, original);
  const onSignal = (signal) => {
    restore();
    process.stderr.write(`\n${signal}: source restored\n`);
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const rows = [];
  const baseline = new Map();
  try {
    for (const mutation of MUTATIONS) {
      if (!baseline.has(mutation.pattern)) baseline.set(mutation.pattern, runFocused(mutation.pattern).status === 0);
      if (!baseline.get(mutation.pattern)) {
        rows.push({ name: mutation.name, result: 'BASELINE-FAILS' });
        continue;
      }
      const occurrences = original.split(mutation.from).length - 1;
      if (occurrences !== 1) {
        rows.push({ name: mutation.name, result: `NOT-APPLIED (${occurrences} matches)` });
        continue;
      }
      writeFileSync(source, original.replace(mutation.from, mutation.to));
      rows.push({ name: mutation.name, result: runFocused(mutation.pattern).status === 0 ? 'SURVIVED' : 'KILLED' });
      restore();
    }
  } finally {
    restore();
  }

  if (digest(readFileSync(source, 'utf8')) !== originalDigest) {
    process.stderr.write('source was not restored byte for byte\n');
    return 2;
  }
  for (const row of rows) process.stdout.write(`${row.result.padEnd(24)} ${row.name}\n`);
  const killed = rows.filter((row) => row.result === 'KILLED').length;
  process.stdout.write(`\n${killed}/${rows.length} mutations killed\n`);
  return killed === rows.length ? 0 : 1;
}

process.exitCode = main();
