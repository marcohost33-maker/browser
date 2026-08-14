// Regression tests for issue #41: the ADR-006 Electron harness could exit 0
// while the control it claims to measure was never exercised.
//
// Every test here asserts on the EXIT CODE the harness would report (or on the
// value that directly determines it), not on the presence of a field. The
// Electron main process itself cannot be loaded in this suite (it requires the
// Electron binary and a display), so the decision logic lives in
// spike/runtime-eval/harness/electron/harness-lib.js and main.js delegates to
// it. Tests that would need a real Electron run are named as such and are NOT
// claimed to be covered here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import lib from '../../spike/runtime-eval/harness/electron/harness-lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE_DIR = join(HERE, '..', '..', 'spike', 'runtime-eval');
const HARNESS_DIR = join(SPIKE_DIR, 'harness', 'electron');
const ASSERTIONS = JSON.parse(readFileSync(join(SPIKE_DIR, 'assertions.json'), 'utf8'));

// A full, clean run: every probe present and as-expected, every fixture PASS.
function goodResults() {
  const probes = Object.entries(ASSERTIONS.probes).map(([id, rule], i) => ({
    index: i + 1,
    id,
    category: rule.category,
    status: rule.expected[0],
    detail: 'ok',
  }));
  return { probes };
}

const PASS = (detail) => ({ verdict: 'PASS', detail });

function goodFixtures() {
  return {
    navigateExternal: PASS('DENIED (origin unchanged)'),
    triggerDownload: PASS('DENIED (will-download prevented, count +1)'),
    crash: PASS('CONTAINED (relaunch produced results=true)'),
    hang: PASS("DETECTED ('unresponsive' at ~2000ms)"),
  };
}

const REQUIRED_FIXTURES = ['navigateExternal', 'triggerDownload', 'crash', 'hang'];

function runVerdict(overrides = {}) {
  const results = 'results' in overrides ? overrides.results : goodResults();
  const report = lib.compareProbes(ASSERTIONS.probes, results);
  return lib.evaluateRun({
    byteLock: { ok: true, detail: 'ok' },
    ran: report.ran,
    deviations: report.deviations,
    missing: report.missing,
    securityNegatives: lib.securityNegatives(report.comparison),
    egressBlockedExternal: 0,
    coldDoneState: 'done',
    warmDoneState: 'done',
    fixtures: goodFixtures(),
    requiredFixtures: REQUIRED_FIXTURES,
    ...overrides,
  });
}

// Guard for every test below: the "everything is fine" baseline must be 0,
// otherwise a red test proves nothing about the specific gap under test.
test('baseline: a complete, passing run exits 0', () => {
  const v = runVerdict();
  assert.deepEqual(v.reasons, []);
  assert.equal(v.exitCode, 0);
});

// -------------------------------------------------------------------------
// P1 #1 — a failing isolation assertion can still produce HARNESS_EXIT=0
// -------------------------------------------------------------------------
test('P1: a fixture that was exercised and FAILED forces exit 1', () => {
  const fixtures = goodFixtures();
  fixtures.triggerDownload = { verdict: 'FAIL', detail: 'NOT-DENIED (no will-download event observed)' };
  const v = runVerdict({ fixtures });
  assert.equal(v.exitCode, lib.EXIT.CONTROL_FAILED);
  assert.match(v.failed.join('\n'), /triggerDownload: FAIL/);
});

test('P1: a failed crash/relaunch check forces exit 1, it is not prose-only', () => {
  const fixtures = goodFixtures();
  fixtures.crash = { verdict: 'FAIL', detail: 'NOT-CONTAINED (relaunch produced results=false)' };
  assert.equal(runVerdict({ fixtures }).exitCode, lib.EXIT.CONTROL_FAILED);
});

test('P1: a fixture that never ran is NOT MEASURED (exit 4), never a pass', () => {
  const fixtures = goodFixtures();
  delete fixtures.navigateExternal;
  const v = runVerdict({ fixtures });
  assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(v.notMeasured.join('\n'), /navigateExternal: NOT-RUN/);
});

test('P1: pass, fail and not-measured are three distinguishable exit codes', () => {
  const passing = runVerdict().exitCode;
  const failing = runVerdict({
    fixtures: { ...goodFixtures(), triggerDownload: { verdict: 'FAIL', detail: 'x' } },
  }).exitCode;
  const unmeasured = runVerdict({
    fixtures: { ...goodFixtures(), hang: { verdict: 'INCONCLUSIVE', detail: 'no observation in 12s' } },
  }).exitCode;
  assert.equal(new Set([passing, failing, unmeasured]).size, 3);
  assert.deepEqual([passing, failing, unmeasured], [0, 1, 4]);
});

// -------------------------------------------------------------------------
// P1 #2 — a missing probe is not distinguishable from a passing one
// -------------------------------------------------------------------------
test('P1: an omitted probe is MISSING and forces a non-zero exit', () => {
  const results = goodResults();
  results.probes = results.probes.filter((p) => p.id !== 'native_ipc_zero_grant');
  const report = lib.compareProbes(ASSERTIONS.probes, results);
  assert.deepEqual(report.missing, ['native_ipc_zero_grant']);
  const v = runVerdict({ results });
  assert.notEqual(v.exitCode, 0);
  assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(v.notMeasured.join('\n'), /native_ipc_zero_grant/);
});

test('P1: securityNegativesAllBlocked is false when a security probe is absent', () => {
  const results = goodResults();
  results.probes = results.probes.filter((p) => p.id !== 'native_ipc_zero_grant');
  const sec = lib.securityNegatives(lib.compareProbes(ASSERTIONS.probes, results).comparison);
  assert.equal(sec.allBlocked, false);
  assert.equal(sec.incomplete, true);
  assert.deepEqual(sec.missing, ['native_ipc_zero_grant']);
});

test('P1: the comparison always covers the full assertion set', () => {
  const report = lib.compareProbes(ASSERTIONS.probes, { probes: [] });
  assert.equal(report.comparison.length, Object.keys(ASSERTIONS.probes).length);
  assert.equal(report.missing.length, Object.keys(ASSERTIONS.probes).length);
});

test('P1: an empty security set is not a vacuous pass', () => {
  assert.equal(lib.securityNegatives([]).allBlocked, false);
});

test('P1: a payload cannot relabel a security negative into another category', () => {
  const results = goodResults();
  const p = results.probes.find((x) => x.id === 'csp_eval');
  p.category = 'capability';   // payload lies about the category
  p.status = 'PASS';           // ... and about the outcome
  const report = lib.compareProbes(ASSERTIONS.probes, results);
  const entry = report.comparison.find((c) => c.id === 'csp_eval');
  assert.equal(entry.category, 'security'); // taken from assertions.json
  assert.equal(lib.securityNegatives(report.comparison).notBlocked.includes('csp_eval'), true);
  assert.equal(runVerdict({ results }).exitCode, lib.EXIT.CONTROL_FAILED);
});

// -------------------------------------------------------------------------
// P1 #3 — the payload byte lock is never checked before a run
// -------------------------------------------------------------------------
test('P1: a run without a satisfied byte lock exits 5 and measures nothing', () => {
  const v = lib.evaluateRun({
    byteLock: { ok: false, detail: 'verify-determinism.mjs exited 1' },
    ran: true,
    deviations: 0,
    missing: [],
    securityNegatives: { allBlocked: true, incomplete: false, notBlocked: [], missing: [] },
    egressBlockedExternal: 0,
    coldDoneState: 'done',
    warmDoneState: 'done',
    fixtures: goodFixtures(),
    requiredFixtures: REQUIRED_FIXTURES,
  });
  assert.equal(v.exitCode, lib.EXIT.BYTE_LOCK);
});

test('P1: an unverified byte lock is fail-closed (exit 5), not assumed good', () => {
  const v = runVerdict({ byteLock: undefined });
  assert.equal(v.exitCode, lib.EXIT.BYTE_LOCK);
});

test('P1: verifyByteLock reports ok=false when the gate script exits non-zero', () => {
  const bad = lib.verifyByteLock({
    scriptPath: 's.mjs',
    execPath: 'node',
    run: () => ({ status: 1, stdout: '', stderr: 'hash mismatch: payload/app.mjs' }),
  });
  assert.equal(bad.ok, false);
  assert.match(bad.output, /hash mismatch/);

  const good = lib.verifyByteLock({
    scriptPath: 's.mjs',
    execPath: 'node',
    run: () => ({ status: 0, stdout: 'OK: 5 assets byte-identical', stderr: '' }),
  });
  assert.equal(good.ok, true);
});

test('P1: verifyByteLock is fail-closed when the runner itself cannot start', () => {
  const v = lib.verifyByteLock({
    scriptPath: 's.mjs',
    execPath: 'node',
    run: () => { throw new Error('spawn ENOENT'); },
  });
  assert.equal(v.ok, false);
});

test('P1: the real byte-lock gate runs and passes against the committed manifest', (t) => {
  // Uses the actual verify-determinism.mjs, not a stub: proves the wiring works.
  const res = spawnSync(process.execPath, [join(SPIKE_DIR, 'verify-determinism.mjs')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /assets byte-identical to asset-manifest\.json/);
  t.diagnostic(res.stdout.trim().split('\n').pop());
});

test('P1: npm start cannot run the harness without the byte-lock gate', () => {
  const pkg = JSON.parse(readFileSync(join(HARNESS_DIR, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.prestart || '', /verify:payload/);
  assert.match(pkg.scripts['verify:payload'] || '', /verify-determinism\.mjs/);
  // ... and main.js runs it in-process, so `electron .` cannot bypass prestart.
  const main = readFileSync(join(HARNESS_DIR, 'main.js'), 'utf8');
  assert.match(main, /lib\.verifyByteLock\(/);
  assert.match(main, /EXIT\.BYTE_LOCK/);
});

// -------------------------------------------------------------------------
// P1 #4 — the exact-origin navigation gate does not cover custom-scheme URLs
// -------------------------------------------------------------------------
test('P1: app://other is external even though both origins parse as null', () => {
  assert.equal(new URL('app://local/index.html').origin, new URL('app://other/x').origin); // the bug
  assert.equal(lib.isExternalNavigation('app://local/index.html', 'app://other/x'), true);
});

test('P1: opaque data:/blob:/javascript: navigations are external', () => {
  for (const url of ['data:text/html,<script>1</script>', 'blob:app://local/abc', 'javascript:alert(1)', 'file:///c:/windows/win.ini']) {
    assert.equal(lib.isExternalNavigation('app://local/index.html', url), true, url);
  }
});

test('P1: same-scheme same-host navigation stays internal (no over-blocking)', () => {
  assert.equal(lib.isExternalNavigation('app://local/index.html', 'app://local/sub/page.html'), false);
  assert.equal(lib.isExternalNavigation('https://a.example/x', 'https://a.example/y'), false);
});

test('P1: differing scheme, host or port is external', () => {
  assert.equal(lib.isExternalNavigation('app://local/x', 'https://local/x'), true);
  assert.equal(lib.isExternalNavigation('https://a.example/x', 'https://b.example/x'), true);
  assert.equal(lib.isExternalNavigation('https://a.example:8443/x', 'https://a.example:9443/x'), true);
});

test('P1: an unparseable target is external (fail-closed)', () => {
  assert.equal(lib.isExternalNavigation('app://local/x', 'not a url'), true);
  assert.equal(lib.isExternalNavigation('app://local/x', ''), true);
});

test('an attempted external request forces exit 1, a broken counter forces exit 4', () => {
  assert.equal(runVerdict({ egressBlockedExternal: 1 }).exitCode, lib.EXIT.CONTROL_FAILED);
  for (const broken of [-5, 1.5, NaN, undefined, '0']) {
    const v = runVerdict({ egressBlockedExternal: broken });
    assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED, `egress=${String(broken)}`);
    assert.match(v.notMeasured.join('\n'), /egress counter unusable/);
  }
});

// -------------------------------------------------------------------------
// P2 #6 — an incomplete warm run is accepted
// -------------------------------------------------------------------------
test('P2: a warm load that never settled is NOT MEASURED (exit 4)', () => {
  const v = runVerdict({ warmDoneState: 'timeout' });
  assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(v.notMeasured.join('\n'), /warm load never settled/);
});

test('P2: a cold load that never settled is NOT MEASURED too', () => {
  assert.equal(runVerdict({ coldDoneState: 'timeout' }).exitCode, lib.EXIT.NOT_MEASURED);
});

test('P2: state=error still counts as a completed load (probe FAIL echo)', () => {
  assert.equal(runVerdict({ warmDoneState: 'error', coldDoneState: 'error' }).exitCode, 0);
});

// -------------------------------------------------------------------------
// P2 #7 — reruns overwrite dated historical evidence
// -------------------------------------------------------------------------
test('P2: the results path carries the real platform and run date', () => {
  const r = lib.resolveResultsPath({
    dir: '/d', platform: 'linux', date: new Date('2026-08-14T09:00:00Z'), exists: () => false,
  });
  assert.equal(r.name, 'RESULTS_LINUX_2026-08-14.md');
});

test('P2: an existing document is never overwritten', () => {
  const existing = new Set(['/d/RESULTS_WINDOWS_2026-08-14.md', '/d/RESULTS_WINDOWS_2026-08-14_run2.md']);
  const r = lib.resolveResultsPath({
    dir: '/d', platform: 'win32', date: new Date('2026-08-14T09:00:00Z'), exists: (p) => existing.has(p),
  });
  assert.equal(r.name, 'RESULTS_WINDOWS_2026-08-14_run3.md');
});

test('P2: the committed July evidence cannot be reproduced as a target path', () => {
  const r = lib.resolveResultsPath({
    dir: '/d', platform: 'win32', date: new Date('2026-08-14T09:00:00Z'), exists: () => false,
  });
  assert.notEqual(r.name, 'RESULTS_WINDOWS_2026-07-22.md');
});

test('P2: a run on an unsupported platform is refused, not labelled WINDOWS', () => {
  assert.throws(
    () => lib.resolveResultsPath({ dir: '/d', platform: 'freebsd', date: new Date(), exists: () => false }),
    /unsupported platform/,
  );
  for (const [platform, label] of [['win32', 'WINDOWS'], ['darwin', 'MACOS'], ['linux', 'LINUX']]) {
    assert.equal(lib.platformLabel(platform), label);
  }
});

// -------------------------------------------------------------------------
// CodeQL — incomplete string escaping in the Markdown cell escaper
// -------------------------------------------------------------------------
test('mdCell escapes the backslash before the pipe, so a cell cannot break out', () => {
  assert.equal(lib.mdCell('a\\|b'), 'a\\\\\\|b');
  assert.equal(lib.mdCell('line1\nline2'), 'line1 line2');
});

// -------------------------------------------------------------------------
// Guard: the decision logic must stay reachable from main.js
// -------------------------------------------------------------------------
test('main.js derives its exit code from evaluateRun, not from a local expression', () => {
  const main = readFileSync(join(HARNESS_DIR, 'main.js'), 'utf8');
  assert.match(main, /const verdict = lib\.evaluateRun\(/);
  assert.match(main, /const exitCode = verdict\.exitCode;/);
  assert.doesNotMatch(main, /const exitCode = \(deviations === 0/);
});
