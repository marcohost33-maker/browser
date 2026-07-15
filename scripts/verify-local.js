#!/usr/bin/env node
// verify-local — run the CI gates locally without burning GitHub Actions minutes.
//
// Mirrors security-ci.yml + docs-ci.yml command chain so "more local, less CI"
// stays safe under the Actions budget freeze. The exact Node/npm version gate
// (toolchain:check) is ADVISORY here: local dev machines may run a different Node
// than the pinned CI image, and that must not block a local verify. Required gates
// (lockfile, CSP, tests, markdownlint) still fail the run hard.
//
// Usage:  npm run verify:local        (skips network-dependent steps by default)
//         npm run verify:local -- --with-network   (also runs the audit gate)
//
// No third-party dependencies (matches the repo's zero-runtime-dependency stance).

import { spawnSync } from 'node:child_process';

const withNetwork = process.argv.includes('--with-network');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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
  { key: 'tests', label: 'serializer / served-header / regression tests (test)', args: ['test'], level: 'required' },
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
  const run = spawnSync(npm, step.args, { stdio: 'inherit', shell: process.platform === 'win32' });
  const ok = run.status === 0;
  results.push({ ...step, status: ok ? 'PASS' : step.level === 'required' ? 'FAIL' : 'WARN' });
}

const badge = { PASS: '✔ PASS', FAIL: '✖ FAIL', WARN: '⚠ WARN', SKIP: '– SKIP' };
process.stdout.write('\n\n========== verify:local summary ==========\n');
for (const r of results) {
  process.stdout.write(`  ${badge[r.status].padEnd(8)} ${r.label}\n`);
  if ((r.status === 'WARN' || r.status === 'SKIP') && r.note) process.stdout.write(`           ↳ ${r.note}\n`);
}

const failed = results.filter((r) => r.status === 'FAIL');
const warned = results.filter((r) => r.status === 'WARN');
process.stdout.write('==========================================\n');
if (failed.length) {
  process.stdout.write(`\nRESULT: FAILED — ${failed.length} required gate(s) failed: ${failed.map((f) => f.key).join(', ')}\n`);
  process.stdout.write('Do not push until these pass. This is the same gate CI enforces.\n');
  process.exit(1);
}
process.stdout.write(`\nRESULT: OK — all required gates passed${warned.length ? `; ${warned.length} advisory warning(s)` : ''}.\n`);
process.stdout.write('Safe to commit. (CI still runs the exact-version + SBOM/evidence + link-check steps on push.)\n');
process.exit(0);
