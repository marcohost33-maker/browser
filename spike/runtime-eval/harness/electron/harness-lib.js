// ADR-006 harness decision logic — deliberately Electron-free so it is testable.
//
// WHY THIS FILE EXISTS (issue #41)
//   Every rule that decides whether a run may claim success used to live inside
//   main.js, which cannot be loaded without Electron and therefore could not be
//   tested at all. The four P1 findings of #41 all sit on that decision path.
//   The rules now live here, are imported by main.js, and are exercised by
//   tests/spike/adr006-harness.test.js.
//
// THE CONTRACT
//   A run may only report exit 0 when every control it claims to measure was
//   demonstrably exercised AND passed. "Not measured" is never allowed to look
//   like "passed": it gets its own exit code.
//
//     0  every claimed control was exercised and passed
//     1  a control was exercised and FAILED
//     2  harness crash (set by main.js)
//     3  watchdog timeout (set by main.js)
//     4  NOT MEASURED — a claimed control was absent, incomplete or inconclusive
//     5  payload byte lock not satisfied (precondition; nothing was measured)
//
//   Precedence when several apply: 5 > 1 > 4 > 0. A failed control outranks an
//   unmeasured one because it is the more actionable signal; both are non-zero.

'use strict';

const EXIT = Object.freeze({
  OK: 0,
  CONTROL_FAILED: 1,
  HARNESS_CRASH: 2,
  WATCHDOG: 3,
  NOT_MEASURED: 4,
  BYTE_LOCK: 5,
});

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// ---------------------------------------------------------------------------
// #41 P1 — "a missing probe is not distinguishable from a passing one"
// Iterate the COMPLETE assertion set, not the list the payload happened to
// return. A probe the payload omits becomes an explicit MISSING entry.
// The category is taken from assertions.json, never from the payload, so a
// payload cannot re-label a security negative into a harmless category.
// ---------------------------------------------------------------------------
function compareProbes(assertionProbes, results) {
  const probes = results && Array.isArray(results.probes) ? results.probes : null;
  const byId = new Map();
  if (probes) {
    for (const p of probes) {
      if (p && typeof p.id === 'string' && !byId.has(p.id)) byId.set(p.id, p);
    }
  }

  const comparison = [];
  let deviations = 0;
  const missing = [];

  for (const id of Object.keys(assertionProbes)) {
    const rule = assertionProbes[id];
    const expected = Array.isArray(rule.expected) ? rule.expected : [];
    const p = byId.get(id);
    if (!p) {
      missing.push(id);
      comparison.push({
        index: null,
        id,
        category: rule.category,
        status: 'MISSING',
        expected,
        verdict: 'MISSING',
        detail: 'probe absent from window.__spikeResults — control was never exercised',
      });
      continue;
    }
    const asExpected = expected.includes(p.status);
    if (!asExpected) deviations += 1;
    comparison.push({
      index: p.index,
      id,
      category: rule.category,
      status: p.status,
      expected,
      verdict: asExpected ? 'as-expected' : 'DEVIATION',
      detail: p.detail,
    });
  }

  // A probe the payload reports that assertions.json does not know about is a
  // deviation too: it is unspecified output, not evidence.
  for (const [id, p] of byId) {
    if (has(assertionProbes, id)) continue;
    deviations += 1;
    comparison.push({
      index: p.index,
      id,
      category: p.category,
      status: p.status,
      expected: [],
      verdict: 'UNEXPECTED-PROBE',
      detail: p.detail,
    });
  }

  return { comparison, deviations, missing, ran: !!probes };
}

// Tri-state, because "one security negative is MISSING" is not the same claim
// as "one security negative was exercised and came back unblocked".
// An empty security set is NOT a pass (no vacuous truth).
function securityNegatives(comparison) {
  const entries = comparison.filter((c) => c.category === 'security');
  const missing = entries.filter((c) => c.verdict === 'MISSING').map((c) => c.id);
  const notBlocked = entries
    .filter((c) => c.verdict !== 'MISSING')
    .filter((c) => !(c.status === 'BLOCKED' || (c.id === 'trusted_types' && c.status === 'SKIP')))
    .map((c) => c.id);
  return {
    count: entries.length,
    missing,
    notBlocked,
    incomplete: entries.length === 0 || missing.length > 0,
    allBlocked: entries.length > 0 && missing.length === 0 && notBlocked.length === 0,
  };
}

// ---------------------------------------------------------------------------
// #41 P1 — "a failing isolation assertion can still produce HARNESS_EXIT=0"
// Fixtures are structured {verdict, detail} objects; prose is never parsed.
//   PASS         exercised, control held
//   FAIL         exercised, control did NOT hold  -> exit 1
//   NOT-RUN      never triggered                  -> exit 4
//   INCONCLUSIVE triggered, no observation inside the bound -> exit 4
//   ERROR        threw before an observation      -> exit 4
// ---------------------------------------------------------------------------
const FIXTURE_VERDICTS = Object.freeze(['PASS', 'FAIL', 'NOT-RUN', 'INCONCLUSIVE', 'ERROR']);

function evaluateFixtures(fixtures, required) {
  const names = required || Object.keys(fixtures || {});
  const failed = [];
  const notMeasured = [];
  for (const name of names) {
    const f = fixtures && has(fixtures, name) ? fixtures[name] : null;
    const verdict = f && typeof f.verdict === 'string' ? f.verdict : 'NOT-RUN';
    if (!FIXTURE_VERDICTS.includes(verdict)) {
      failed.push(`${name}: unknown verdict ${JSON.stringify(verdict)}`);
      continue;
    }
    if (verdict === 'FAIL') failed.push(`${name}: ${verdict} — ${(f && f.detail) || ''}`);
    else if (verdict !== 'PASS') notMeasured.push(`${name}: ${verdict} — ${(f && f.detail) || 'no observation'}`);
  }
  return { failed, notMeasured };
}

// ---------------------------------------------------------------------------
// The single place that decides HARNESS_EXIT.
// ---------------------------------------------------------------------------
function evaluateRun(input) {
  const failed = [];
  const notMeasured = [];

  const byteLock = input.byteLock;
  if (!byteLock || byteLock.ok !== true) {
    return {
      exitCode: EXIT.BYTE_LOCK,
      failed: [],
      notMeasured: [],
      byteLockProblem: (byteLock && byteLock.detail) || 'payload byte lock was never verified',
      reasons: [`byte lock: ${(byteLock && byteLock.detail) || 'never verified'}`],
    };
  }

  if (!input.ran) notMeasured.push('payload module never produced window.__spikeResults');
  if (Array.isArray(input.missing) && input.missing.length) {
    notMeasured.push(`probes absent from the run: ${input.missing.join(', ')}`);
  }
  if (input.deviations > 0) failed.push(`${input.deviations} probe deviation(s) against assertions.json`);

  const sec = input.securityNegatives || { incomplete: true, notBlocked: [], missing: [] };
  if (sec.notBlocked && sec.notBlocked.length) {
    failed.push(`security negative(s) not blocked: ${sec.notBlocked.join(', ')}`);
  }
  if (sec.incomplete && !(Array.isArray(input.missing) && input.missing.length)) {
    notMeasured.push('security-negative set incomplete');
  }

  if (input.egressBlockedExternal > 0) {
    failed.push(`${input.egressBlockedExternal} external request(s) attempted`);
  }

  // #41 P2 — an incomplete warm run must not be accepted as a measurement.
  for (const [label, state] of [['cold', input.coldDoneState], ['warm', input.warmDoneState]]) {
    if (state === 'timeout') notMeasured.push(`${label} load never settled (state=timeout)`);
    else if (state !== 'done' && state !== 'error') notMeasured.push(`${label} load state=${state}`);
  }

  const fx = evaluateFixtures(input.fixtures, input.requiredFixtures);
  failed.push(...fx.failed);
  notMeasured.push(...fx.notMeasured);

  let exitCode = EXIT.OK;
  if (failed.length) exitCode = EXIT.CONTROL_FAILED;
  else if (notMeasured.length) exitCode = EXIT.NOT_MEASURED;

  return { exitCode, failed, notMeasured, reasons: [...failed, ...notMeasured] };
}

// ---------------------------------------------------------------------------
// #41 P1 — "the exact-origin navigation gate does not cover custom-scheme URLs"
// URL.origin is "null" for every non-special scheme, so app://local and
// app://other compared equal. Compare scheme + host + port explicitly, and
// treat opaque-origin schemes as never-internal.
// ---------------------------------------------------------------------------
const OPAQUE_SCHEMES = Object.freeze(['data', 'blob', 'javascript', 'filesystem', 'about', 'file']);

function urlParts(u) {
  if (typeof u !== 'string' || u === '') return null;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  return {
    scheme,
    host: parsed.hostname.toLowerCase(),
    port: parsed.port,
    opaque: OPAQUE_SCHEMES.includes(scheme),
  };
}

function isSameOriginStrict(a, b) {
  const pa = urlParts(a);
  const pb = urlParts(b);
  if (!pa || !pb) return false;          // unparseable -> never internal
  if (pa.opaque || pb.opaque) return false; // opaque origin is never "same as" anything
  if (pa.scheme !== pb.scheme) return false;
  if (pa.host !== pb.host) return false;
  return pa.port === pb.port;
}

// Fail-closed: anything that is not provably same-origin is external.
function isExternalNavigation(currentUrl, targetUrl) {
  return !isSameOriginStrict(currentUrl, targetUrl);
}

// ---------------------------------------------------------------------------
// #41 P2 — "reruns overwrite dated historical evidence"
// The path is derived from the real platform and the real run date, and an
// existing file is never overwritten. An unsupported platform is refused
// rather than mislabelled as Windows.
// ---------------------------------------------------------------------------
const PLATFORM_LABEL = Object.freeze({ win32: 'WINDOWS', darwin: 'MACOS', linux: 'LINUX' });

function platformLabel(platform) {
  const label = has(PLATFORM_LABEL, platform) ? PLATFORM_LABEL[platform] : null;
  if (!label) throw new Error(`unsupported platform for a results document: ${platform}`);
  return label;
}

function resolveResultsPath(opts) {
  const { dir, platform, date, exists, join } = opts;
  const label = platformLabel(platform);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid run date: ${String(date)}`);
  const stamp = d.toISOString().slice(0, 10);
  const joiner = join || ((a, b) => `${a}/${b}`);
  for (let n = 1; n <= 99; n += 1) {
    const name = n === 1
      ? `RESULTS_${label}_${stamp}.md`
      : `RESULTS_${label}_${stamp}_run${n}.md`;
    const full = joiner(dir, name);
    if (!exists(full)) return { path: full, name, label, stamp, run: n };
  }
  throw new Error(`refusing to overwrite evidence: 99 result files already exist for ${label} ${stamp}`);
}

// ---------------------------------------------------------------------------
// #41 P1 — "the payload byte lock is never checked before a run"
// The check runs verify-determinism.mjs itself (single source of truth) and is
// fail-closed: a runner that cannot be started leaves ok=false.
// ---------------------------------------------------------------------------
function verifyByteLock(opts) {
  const { scriptPath, execPath, run, env } = opts;
  try {
    const res = run(execPath, [scriptPath], { env, encoding: 'utf8' });
    const code = res && typeof res.status === 'number' ? res.status : (res && res.error ? -1 : 0);
    const out = `${(res && res.stdout) || ''}${(res && res.stderr) || ''}`.trim();
    if (res && res.error) {
      return { ok: false, exitCode: code, detail: `byte-lock check could not run: ${res.error.message}`, output: out };
    }
    if (code !== 0) {
      return { ok: false, exitCode: code, detail: `verify-determinism.mjs exited ${code}`, output: out };
    }
    return { ok: true, exitCode: 0, detail: 'payload bytes identical to asset-manifest.json', output: out };
  } catch (e) {
    return { ok: false, exitCode: -1, detail: `byte-lock check threw: ${e && e.message}`, output: '' };
  }
}

// Markdown table-cell escaping. Backslash MUST be escaped first, otherwise an
// input backslash turns the escape of the following pipe into a literal.
function mdCell(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

module.exports = {
  EXIT,
  compareProbes,
  securityNegatives,
  evaluateFixtures,
  evaluateRun,
  urlParts,
  isSameOriginStrict,
  isExternalNavigation,
  platformLabel,
  resolveResultsPath,
  verifyByteLock,
  mdCell,
  FIXTURE_VERDICTS,
};
