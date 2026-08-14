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
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// PR#42 P1: the host-level assertions of the contract are required too. The
// list is derived from assertions.json, exactly as main.js derives it.
const REQUIRED_HOST_ASSERTIONS = Object.keys(ASSERTIONS.hostLevelAssertions);

function goodHostAssertions() {
  const out = {};
  for (const k of REQUIRED_HOST_ASSERTIONS) out[k] = PASS(`${k} observed at host level`);
  return out;
}

// A warm load whose window.__spikeResults were read and compared.
function goodWarmProbes() {
  return { ran: true, deviations: 0, missing: [] };
}

function runVerdict(overrides = {}) {
  const results = 'results' in overrides ? overrides.results : goodResults();
  const report = lib.compareProbes(ASSERTIONS.probes, results);
  return lib.evaluateRun({
    byteLock: { ok: true, detail: 'ok' },
    contractLock: { ok: true, detail: 'assertions.json sha256 matches' },
    sessionMode: 'in-memory-partition',
    ran: report.ran,
    deviations: report.deviations,
    missing: report.missing,
    securityNegatives: lib.securityNegatives(report.comparison),
    egressBlockedExternal: 0,
    coldDoneState: 'done',
    warmDoneState: 'done',
    warmProbes: goodWarmProbes(),
    fixtures: goodFixtures(),
    requiredFixtures: REQUIRED_FIXTURES,
    hostAssertions: goodHostAssertions(),
    requiredHostAssertions: REQUIRED_HOST_ASSERTIONS,
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

// -------------------------------------------------------------------------
// PR#42 P1 (harness-lib.js:199) — a warm error state was accepted as complete
// -------------------------------------------------------------------------
test('PR42 P1: a warm state=error whose probes deviate forces exit 1, not 0', () => {
  // The cold load is clean; a state-dependent control fails only on the second
  // load. Before the fix this was exit 0 with warmDoneState=error in the report.
  const v = runVerdict({
    warmDoneState: 'error',
    warmProbes: { ran: true, deviations: 1, missing: [] },
  });
  assert.equal(v.exitCode, lib.EXIT.CONTROL_FAILED);
  assert.match(v.failed.join('\n'), /warm-run probe deviation/);
});

test('PR42 P1: a settled warm load whose results were never read is exit 4', () => {
  for (const state of ['done', 'error']) {
    const v = runVerdict({ warmDoneState: state, warmProbes: undefined });
    assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED, `state=${state}`);
    assert.match(v.notMeasured.join('\n'), /window\.__spikeResults were never read/);
  }
});

test('PR42 P1: a warm probe missing from the second load is exit 4', () => {
  const v = runVerdict({ warmProbes: { ran: true, deviations: 0, missing: ['service_worker'] } });
  assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(v.notMeasured.join('\n'), /absent from the warm run: service_worker/);
});

test('PR42 P1: a state=error that no compared probe explains is exit 4, never 0', () => {
  const warm = runVerdict({ warmDoneState: 'error' });
  assert.equal(warm.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(warm.notMeasured.join('\n'), /warm load reported state=error that no compared probe explains/);
  const cold = runVerdict({ coldDoneState: 'error' });
  assert.equal(cold.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(cold.notMeasured.join('\n'), /cold load reported state=error that no compared probe explains/);
});

test('P2: state=error explained by a compared deviation is exit 1 (FAIL echo)', () => {
  // The old contract accepted this as "completed load" and returned 0.
  const results = goodResults();
  results.probes.find((p) => p.id === 'cachestorage').status = 'FAIL';
  const v = runVerdict({
    results,
    coldDoneState: 'error',
    warmDoneState: 'error',
    warmProbes: { ran: true, deviations: 1, missing: [] },
  });
  assert.equal(v.exitCode, lib.EXIT.CONTROL_FAILED);
});

// -------------------------------------------------------------------------
// PR#42 P1 (main.js:495) — the host-level assertions were not required
// -------------------------------------------------------------------------
test('PR42 P1: external_protocol_os is part of the required contract set', () => {
  assert.ok(REQUIRED_HOST_ASSERTIONS.includes('external_protocol_os'));
});

test('PR42 P1: a missing external_protocol_os verdict cannot exit 0', () => {
  const host = goodHostAssertions();
  delete host.external_protocol_os;
  const v = runVerdict({ hostAssertions: host });
  assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(v.notMeasured.join('\n'), /host assertion external_protocol_os: NOT-RUN/);
});

test('PR42 P1: an INCONCLUSIVE OS observation is exit 4, a launched handler is exit 1', () => {
  const inconclusive = runVerdict({
    hostAssertions: {
      ...goodHostAssertions(),
      external_protocol_os: { verdict: 'INCONCLUSIVE', detail: 'no OS handler registered for any probed scheme' },
    },
  });
  assert.equal(inconclusive.exitCode, lib.EXIT.NOT_MEASURED);
  const launched = runVerdict({
    hostAssertions: {
      ...goodHostAssertions(),
      external_protocol_os: { verdict: 'FAIL', detail: 'OS handler process launched: mailto->outlook.exe' },
    },
  });
  assert.equal(launched.exitCode, lib.EXIT.CONTROL_FAILED);
  assert.match(launched.failed.join('\n'), /host assertion external_protocol_os: FAIL/);
});

test('PR42 P1: every host assertion of the contract is required, not just one', () => {
  for (const key of REQUIRED_HOST_ASSERTIONS) {
    const host = goodHostAssertions();
    delete host[key];
    assert.notEqual(runVerdict({ hostAssertions: host }).exitCode, 0, key);
  }
});

test('PR42 P1: an empty required-host list is not a vacuous pass', () => {
  for (const empty of [[], undefined, null]) {
    const v = runVerdict({ requiredHostAssertions: empty, hostAssertions: {} });
    assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED, String(empty));
    assert.match(v.notMeasured.join('\n'), /no host-level assertions were required/);
  }
});

// -------------------------------------------------------------------------
// PR#42 P1 (main.js:258) — the byte lock did not cover assertions.json
// -------------------------------------------------------------------------
test('PR42 P1: an unlocked assertion contract exits 5 and measures nothing', () => {
  const v = runVerdict({ contractLock: { ok: false, detail: 'assertions.json: sha256 aaa != committed bbb' } });
  assert.equal(v.exitCode, lib.EXIT.BYTE_LOCK);
  assert.deepEqual(v.failed, []);
  assert.match(v.reasons.join('\n'), /assertion contract lock/);
});

test('PR42 P1: an absent contract lock is fail-closed (exit 5), not assumed good', () => {
  assert.equal(runVerdict({ contractLock: undefined }).exitCode, lib.EXIT.BYTE_LOCK);
});

test('PR42 P1: widening a security probe in assertions.json breaks the contract hash', () => {
  const manifest = JSON.parse(readFileSync(join(SPIKE_DIR, 'asset-manifest.json'), 'utf8'));
  const real = readFileSync(join(SPIKE_DIR, 'assertions.json'));
  const ok = lib.verifyContractLock({ bytes: real, manifest, key: 'assertions.json' });
  assert.equal(ok.ok, true, ok.detail);

  // The exact attack from the review: allow FAIL for a security negative.
  const widened = JSON.parse(real.toString('utf8'));
  widened.probes.native_ipc_zero_grant.expected.push('FAIL');
  const bad = lib.verifyContractLock({
    bytes: Buffer.from(JSON.stringify(widened, null, 2)),
    manifest,
    key: 'assertions.json',
  });
  assert.equal(bad.ok, false);
  assert.equal(runVerdict({ contractLock: bad }).exitCode, lib.EXIT.BYTE_LOCK);
});

test('PR42 P1: a manifest without a contracts section cannot satisfy the lock', () => {
  const real = readFileSync(join(SPIKE_DIR, 'assertions.json'));
  for (const manifest of [{}, { contracts: {} }, { contracts: { 'other.json': 'x' } }, null]) {
    const v = lib.verifyContractLock({ bytes: real, manifest, key: 'assertions.json' });
    assert.equal(v.ok, false, JSON.stringify(manifest));
  }
});

test('PR42 P1: the real gate script REFUSES a widened contract (end-to-end, copy of the spike)', () => {
  // Runs the actual verify-determinism.mjs against an isolated copy: the
  // payload bytes stay untouched (that was the whole point of the finding) and
  // only assertions.json is widened by adding FAIL to a security probe.
  const tmp = mkdtempSync(join(tmpdir(), 'runtime-eval-contract-'));
  try {
    for (const entry of ['payload', 'assertions.json', 'asset-manifest.json', 'verify-determinism.mjs']) {
      cpSync(join(SPIKE_DIR, entry), join(tmp, entry), { recursive: true });
    }
    const clean = spawnSync(process.execPath, [join(tmp, 'verify-determinism.mjs')], { encoding: 'utf8' });
    assert.equal(clean.status, 0, `the untouched copy must pass: ${clean.stderr}`);

    const widened = JSON.parse(readFileSync(join(tmp, 'assertions.json'), 'utf8'));
    widened.probes.csp_eval.expected.push('FAIL');
    writeFileSync(join(tmp, 'assertions.json'), `${JSON.stringify(widened, null, 2)}\n`);

    const after = spawnSync(process.execPath, [join(tmp, 'verify-determinism.mjs')], { encoding: 'utf8' });
    assert.equal(after.status, 1, 'a widened contract must fail the gate');
    assert.match(after.stderr, /contract hash mismatch: assertions\.json/);
    assert.doesNotMatch(after.stderr, /hash mismatch: app\.mjs/); // payload untouched
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('PR42 P1: the real gate script locks assertions.json, not only payload/', () => {
  const manifest = JSON.parse(readFileSync(join(SPIKE_DIR, 'asset-manifest.json'), 'utf8'));
  assert.ok(manifest.contracts && manifest.contracts['assertions.json'], 'manifest must lock the contract');
  const gate = readFileSync(join(SPIKE_DIR, 'verify-determinism.mjs'), 'utf8');
  assert.match(gate, /CONTRACT_FILES/);
  assert.match(gate, /contracts/);
});

// -------------------------------------------------------------------------
// PR#42 P2 (main.js:245) — a failed session clear was measured as "cold"
// -------------------------------------------------------------------------
test('PR42 P2: a session whose clear failed is NOT MEASURED (exit 4)', () => {
  const v = runVerdict({ sessionMode: 'default-session-CLEAR-FAILED (EBUSY)' });
  assert.equal(v.exitCode, lib.EXIT.NOT_MEASURED);
  assert.match(v.notMeasured.join('\n'), /not provably cold/);
});

test('PR42 P2: an unknown or absent session mode is fail-closed', () => {
  for (const mode of [undefined, null, '', 'default-session', 'persist:whatever', 42]) {
    assert.equal(runVerdict({ sessionMode: mode }).exitCode, lib.EXIT.NOT_MEASURED, String(mode));
  }
});

test('PR42 P2: exactly the two genuinely cold session modes exit 0', () => {
  assert.deepEqual([...lib.COLD_SESSION_MODES], ['in-memory-partition', 'default-session-cleared']);
  for (const mode of lib.COLD_SESSION_MODES) {
    assert.equal(runVerdict({ sessionMode: mode }).exitCode, 0, mode);
  }
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

// The four PR#42 findings are all "main.js never hands the observation to the
// decision". These guards fail if that wiring is removed again; the semantics
// of each input are covered by the exit-code tests above.
test('PR42: main.js feeds warm results, host assertions, contract lock and session mode into evaluateRun', () => {
  const main = readFileSync(join(HARNESS_DIR, 'main.js'), 'utf8');
  const call = /const verdict = lib\.evaluateRun\(\{([\s\S]*?)\n  \}\);/.exec(main);
  assert.ok(call, 'evaluateRun call not found');
  for (const key of ['contractLock', 'sessionMode:', 'warmProbes', 'hostAssertions', 'requiredHostAssertions']) {
    assert.match(call[1], new RegExp(key.replace('.', '\\.')), `evaluateRun must receive ${key}`);
  }
  // The warm page's results are actually read, and the host list comes from the
  // contract file rather than a hand-written literal.
  assert.match(main, /warmWin\.webContents\.executeJavaScript\('window\.__spikeResults'\)/);
  assert.match(main, /lib\.compareProbes\(ASSERTIONS\.probes, warmResults\)/);
  assert.match(main, /Object\.keys\(ASSERTIONS\.hostLevelAssertions/);
  assert.match(main, /lib\.verifyContractLock\(/);
  assert.match(main, /measureExternalProtocolOs/);
});
