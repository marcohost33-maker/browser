#!/usr/bin/env node
// verify-local — run the required offline CI gates locally without consuming
// GitHub Actions minutes. Network-dependent audit evidence is opt-in.

import { spawnSync } from 'node:child_process';

import { npmInvocation } from './npm-invocation.js';

const withNetwork = process.argv.includes('--with-network');

// level: 'required' -> failure fails the run; 'advisory' -> failure warns only.
const steps = [
  {
    key: 'toolchain',
    label: 'exact Node/npm/registry policy (toolchain:check)',
    args: ['run', 'toolchain:check'],
    level: 'advisory',
    note: 'CI pins Node 22.23.1; a different local Node is expected and OK here.',
  },
  { key: 'lockfile', label: 'frozen lockfile invariants (lockfile:check)', args: ['run', 'lockfile:check'], level: 'required' },
  {
    key: 'audit',
    label: 'dependency vulnerability gate (audit:ci)',
    args: ['run', 'audit:ci'],
    level: 'advisory',
    skip: !withNetwork,
    note: 'needs network; pass --with-network to run it.',
  },
  { key: 'csp', label: 'CSP / endpoint / header fail-closed gate (csp:check)', args: ['run', 'csp:check'], level: 'required' },
  { key: 'tests', label: 'security and governance regression tests (test)', args: ['test'], level: 'required' },
  { key: 'docs-governance', label: 'ADR identity and local-link consistency (docs:governance)', args: ['run', 'docs:governance'], level: 'required' },
  { key: 'docs-lint', label: 'markdownlint (docs:lint)', args: ['run', 'docs:lint'], level: 'required' },
];

const results = [];
for (const step of steps) {
  if (step.skip) {
    results.push({ ...step, status: 'SKIP' });
    process.stdout.write(`\n── SKIP  ${step.label}${step.note ? `  (${step.note})` : ''}\n`);
    continue;
  }
  process.stdout.write(`\n── RUN   ${step.label}\n`);
  const [command, argv] = npmInvocation(step.args);
  const run = spawnSync(command, argv, { stdio: 'inherit' });
  const ok = run.status === 0;
  results.push({ ...step, status: ok ? 'PASS' : step.level === 'required' ? 'FAIL' : 'WARN' });
}

const badge = { PASS: '✔ PASS', FAIL: '✖ FAIL', WARN: '⚠ WARN', SKIP: '– SKIP' };
process.stdout.write('\n\n========== verify:local summary ==========\n');
for (const result of results) {
  process.stdout.write(`  ${badge[result.status].padEnd(8)} ${result.label}\n`);
  if ((result.status === 'WARN' || result.status === 'SKIP') && result.note) {
    process.stdout.write(`           ↳ ${result.note}\n`);
  }
}

const failed = results.filter((result) => result.status === 'FAIL');
const warned = results.filter((result) => result.status === 'WARN');
process.stdout.write('==========================================\n');
if (failed.length) {
  process.stdout.write(`\nRESULT: FAILED — ${failed.length} required gate(s) failed: ${failed.map((result) => result.key).join(', ')}\n`);
  process.stdout.write('Do not push until these pass.\n');
  process.exit(1);
}
process.stdout.write(`\nRESULT: OK — all required gates passed${warned.length ? `; ${warned.length} advisory warning(s)` : ''}.\n`);
process.stdout.write('Safe to commit. CI still owns exact toolchain, SBOM, evidence and link checks.\n');
process.exit(0);
