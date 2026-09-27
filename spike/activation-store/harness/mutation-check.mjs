#!/usr/bin/env node
// Mutation check for the activation store: reverts one control at a time and requires
// that at least one focused test fails. A control whose removal keeps every test green
// is not tested. The source file is restored on exit, including on SIGINT/SIGTERM, and
// its digest is verified afterwards.
//
//   node spike/activation-store/harness/mutation-check.mjs
//
// Mutations are exact source substitutions. When the store changes, a mutation that no
// longer applies is reported as NOT-APPLIED and fails the run: the list must follow the
// code instead of silently shrinking.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '..', '..', '..');
const source = path.join(here, '..', 'activation-store.js');
const storeTests = 'tests/activation/activation-store.test.js';
const matrixTests = 'tests/activation/crash-matrix.test.js';

export const MUTATIONS = Object.freeze([
  {
    name: 'collection forgets the last-good root',
    from: 'for (const versionId of [commit.active, commit.previous]) {\n        if (versionId === null) continue;\n        let record;',
    to: 'for (const versionId of [commit.active]) {\n        if (versionId === null) continue;\n        let record;',
    test: storeTests,
    pattern: 'P1-RECOVERY-1',
  },
  {
    name: 'object directories are not synced',
    from: 'for (const directory of [...directories].sort()) await this.io.syncDir(directory);',
    to: 'void directories;',
    test: matrixTests,
    pattern: 'every crash point',
  },
  {
    name: 'file contents are not synced',
    from: '      await handle.sync();\n    } finally {\n      await handle.close();',
    to: '    } finally {\n      await handle.close();',
    test: matrixTests,
    pattern: 'every crash point',
  },
  {
    name: 'no compare-and-swap on the generation',
    from: "if (generation !== expectedGeneration) {\n        fail('GENERATION_CONFLICT'",
    to: "if (false) {\n        fail('GENERATION_CONFLICT'",
    test: storeTests,
    pattern: 'compare-and-swap',
  },
  {
    name: 'no idempotent re-activation',
    from: 'if (isNoop(current)) return',
    to: 'if (false) return',
    test: storeTests,
    pattern: 'idempotent no-op',
  },
  {
    name: 'forbidden key characters accepted',
    from: 'if (PATH_FORBIDDEN.test(value)) fail(',
    to: 'if (false) fail(',
    test: storeTests,
    pattern: 'unsafe or ambiguous',
  },
  {
    name: 'directory-name collisions accepted',
    from: 'if (spelling !== undefined && spelling !== prefix) {',
    to: 'if (false) {',
    test: storeTests,
    pattern: 'case-folded',
  },
  {
    name: 'every lock looks stale',
    from: 'return !this.processProbe.isAlive(holder.pid);',
    to: 'return true;',
    test: storeTests,
    pattern: 'live writer lock',
  },
  {
    name: 'collection despite an invalid root',
    from: 'const rootsValid = activeCheck?.ok !== false && previousCheck?.ok !== false && report.bindingsValid;',
    to: 'const rootsValid = true;',
    test: storeTests,
    pattern: 'never switches or deletes',
  },
  {
    name: 'commit directory is not synced',
    from: "return (await this.io.syncDir(this.path('state'))) ? 'directory-fsync' : 'unavailable';\n  }",
    to: "return 'directory-fsync';\n  }",
    test: matrixTests,
    pattern: 'every crash point',
  },
  {
    name: 'recovery skips the layout barriers',
    from: '      await this._syncParentOfRoot();\n      await this.io.syncDir(this.root);\n      report.commitBarrier',
    to: '      report.commitBarrier',
    test: matrixTests,
    pattern: 'makes the recovered state durable',
  },
  {
    name: 'missing store directories are recreated',
    from: "if (stat?.type !== 'dir') fail('STORE_LAYOUT_INVALID', `store directory ${name} is missing or not a real directory`);",
    to: "if (stat?.type !== 'dir') await this._ensureDirectory(this.path(name));",
    test: storeTests,
    pattern: 'layout damage',
  },
  {
    name: 'reads skip the content hash',
    from: "if (sha256Hex(bytes) !== digest) fail('OBJECT_CORRUPT', 'object bytes do not match their address', { digest });",
    to: '',
    test: storeTests,
    pattern: 're-verifying bytes',
  },
  {
    name: 'initialisation adopts foreign content',
    from: "if (!(await this._ensureDirectory(path)) && (await this.io.readdir(path)).length > 0) {",
    to: 'if (!(await this._ensureDirectory(path)) && false) {',
    test: storeTests,
    pattern: 'foreign content',
  },
]);

const digest = (text) => createHash('sha256').update(text).digest('hex');

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
  try {
    for (const mutation of MUTATIONS) {
      const occurrences = original.split(mutation.from).length - 1;
      if (occurrences !== 1) {
        rows.push({ name: mutation.name, result: `NOT-APPLIED (${occurrences} matches)` });
        continue;
      }
      writeFileSync(source, original.replace(mutation.from, mutation.to));
      const run = spawnSync(process.execPath, ['--test', '--test-name-pattern', mutation.pattern, mutation.test], {
        cwd: repository,
        encoding: 'utf8',
      });
      rows.push({ name: mutation.name, result: run.status === 0 ? 'SURVIVED' : 'KILLED' });
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
