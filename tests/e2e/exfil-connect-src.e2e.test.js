// Issue #11 (M1B/M1D), ASI02 half: real-browser exfiltration E2E test.
//
// NOT part of `npm test` (that glob is "tests/security/**/*.test.js" and
// stays fast/dependency-free — see package.json "Runtime dependencies: none").
// Run explicitly: node --test tests/e2e/*.e2e.test.js
//
// This spawns Electron (see tests/e2e/runner/run-exfil-probe.cjs for the full
// rationale) to prove, with a real Chromium instance, that a script which got
// execution in the page cannot exfiltrate to a non-allowlisted origin — the
// browser's CSP `connect-src` enforcement is what stops it, not our own
// assumption that it would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SPIKE_ELECTRON_DIR = path.join(REPO_ROOT, 'spike', 'runtime-eval', 'harness', 'electron');
const RUNNER = path.join(__dirname, 'runner', 'run-exfil-probe.cjs');

function electronBinaryOrNull() {
  try {
    // The npm `electron` package's main export, required from plain Node
    // (not from inside Electron itself), resolves to the path of the bundled
    // binary. It already exists as a devDependency of the disjoint
    // spike/runtime-eval/harness/electron spike — nothing new was installed.
    return require(path.join(SPIKE_ELECTRON_DIR, 'node_modules', 'electron'));
  } catch {
    return null;
  }
}

const electronPath = electronBinaryOrNull();

function runProbe(mode) {
  const r = spawnSync(electronPath, [RUNNER, `--mode=${mode}`], {
    cwd: SPIKE_ELECTRON_DIR,
    encoding: 'utf8',
    timeout: 30000,
  });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('PROBE_RESULT_JSON='));
  if (!line) {
    throw new Error(
      `probe produced no result (mode=${mode}, exit=${r.status}) stdout=${r.stdout} stderr=${r.stderr}`,
    );
  }
  return JSON.parse(line.slice('PROBE_RESULT_JSON='.length));
}

const skipReason = electronPath
  ? false
  : 'Electron binary not found under spike/runtime-eval/harness/electron/node_modules — real-browser E2E cannot run without it (run `npm install` in that spike dir first)';

test(
  'ASI02 exfil E2E: real Chromium blocks a fetch to a non-allowlisted origin via the served connect-src',
  { skip: skipReason },
  () => {
    const out = runProbe('protected');
    assert.equal(out.attackerHits, 0, `attacker server must see 0 requests, got ${out.attackerHits}`);
    assert.ok(
      out.result && typeof out.result.fetchOutcome === 'string' && out.result.fetchOutcome.startsWith('rejected'),
      `fetch must be rejected by the browser, got ${JSON.stringify(out.result)}`,
    );
    assert.ok(
      out.result.cspViolation && out.result.cspViolation.violatedDirective === 'connect-src',
      `must be blocked specifically by connect-src (not some other cause), got ${JSON.stringify(out.result)}`,
    );
  },
);

test(
  'discrimination proof: stripping the Content-Security-Policy header lets the same exfil through',
  { skip: skipReason },
  () => {
    // Same fixtures, same script, same attacker server — only the guard under
    // test (the served CSP header) is removed. If this did NOT reach the
    // attacker, the "protected" pass above would prove nothing (something
    // else, not CSP, would be doing the blocking).
    const out = runProbe('unprotected');
    assert.equal(out.cspHeaderServed, false, 'sanity: the discrimination run must actually omit the header');
    assert.ok(
      out.attackerHits >= 1,
      `with the CSP header stripped, the exfil must reach the attacker server ` +
        `(proves CSP — not something else — was blocking it); got ${out.attackerHits} hits`,
    );
  },
);
