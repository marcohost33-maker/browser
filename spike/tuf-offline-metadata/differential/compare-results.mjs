#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const [corpusPath, browserPath, pythonPath, reportPath] = process.argv.slice(2);
if (!corpusPath || !browserPath || !pythonPath || !reportPath) {
  throw new Error(
    'usage: node compare-results.mjs <corpus> <browser> <python> <report>',
  );
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
const browser = JSON.parse(readFileSync(browserPath, 'utf8'));
const python = JSON.parse(readFileSync(pythonPath, 'utf8'));

// Evidence completeness: exactly one decision per corpus case and oracle, from
// the expected oracle. A Map built from the raw list would let a later
// duplicate overwrite an earlier verdict and would ignore extra rows.
const DECISIONS = new Set(['accept', 'reject']);
// Exception classes that say the oracle script drove python-tuf wrongly, not that
// python-tuf judged the metadata: never a valid rejection, in any case.
const ORACLE_MISUSE_ERRORS = new Set(['RuntimeError', 'TypeError', 'KeyError', 'AttributeError', 'NameError']);
const KEYID_METHOD = 'sha256(securesystemslib.formats.encode_canonical(key))';
const pinnedTuf = /^tuf==(\S+)/m.exec(readFileSync(
  new URL('./requirements-oracle.txt', import.meta.url),
  'utf8',
))?.[1];
if (!pinnedTuf) throw new Error('requirements-oracle.txt does not pin tuf==<version>');

if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) {
  throw new Error('corpus holds no cases');
}
const caseNames = new Set();
for (const testCase of corpus.cases) {
  if (typeof testCase.name !== 'string' || caseNames.has(testCase.name)) {
    throw new Error(`corpus case name missing or repeated: ${testCase.name}`);
  }
  caseNames.add(testCase.name);
}

function byName(result, oracle) {
  if (result?.oracle !== oracle) {
    throw new Error(`expected oracle ${oracle}, got ${JSON.stringify(result?.oracle)}`);
  }
  if (!Array.isArray(result.results)) throw new Error(`${oracle} results missing`);
  const map = new Map();
  for (const item of result.results) {
    if (map.has(item?.name)) throw new Error(`${oracle} repeats a decision for ${item.name}`);
    if (!caseNames.has(item?.name)) throw new Error(`${oracle} decided an unknown case ${item?.name}`);
    if (!DECISIONS.has(item.decision)) {
      throw new Error(`${oracle} decision for ${item.name} is ${JSON.stringify(item.decision)}`);
    }
    map.set(item.name, item);
  }
  return map;
}
const browserByName = byName(browser, 'browser-tuf-spike');
const pythonByName = byName(python, 'python-tuf');
if (python.version !== pinnedTuf) {
  throw new Error(`python-tuf ${python.version} is not the pinned ${pinnedTuf}`);
}

let failures = 0;
const rows = [];

for (const testCase of corpus.cases) {
  const browserResult = browserByName.get(testCase.name);
  const pythonResult = pythonByName.get(testCase.name);
  if (!browserResult || !pythonResult) {
    throw new Error(`missing oracle result for ${testCase.name}`);
  }

  const browserExpected =
    browserResult.decision === testCase.expected_browser;
  const pythonExpected = testCase.expected_python_tuf === null
    ? null
    : pythonResult.decision === testCase.expected_python_tuf;
  const agrees = browserResult.decision === pythonResult.decision;

  let pass = browserExpected;
  if (testCase.must_agree) {
    pass = pass && pythonExpected === true && agrees;
  }
  // A rejection only counts for the reason the case is about. Found 2026-11-16: two
  // new rollback cases were first "rejected" by python-tuf with RuntimeError
  // ("Cannot update timestamp after snapshot"), a misuse of its API by the oracle
  // script, and the decisions still agreed. A7-R14: every reject case names the
  // reason for EACH oracle (no default that lets a case pass without one), the
  // python rejection must belong to python-tuf's own error class, and a positive
  // control with the same oracle setup must be accepted by both (checked below).
  const reasons = [];
  const pythonErrorName = pythonResult.error?.name ?? null;
  const oracleMisuse = ORACLE_MISUSE_ERRORS.has(pythonErrorName)
    || (pythonResult.decision === 'reject' && pythonResult.error?.category !== 'repository');
  if (oracleMisuse) reasons.push(`python-tuf error ${pythonErrorName} is not a python-tuf verdict`);
  if (testCase.expected_browser === 'reject') {
    if (typeof testCase.expected_browser_code !== 'string') {
      reasons.push('reject case names no expected_browser_code');
    } else if (browserResult.error?.code !== testCase.expected_browser_code) {
      reasons.push(`browser code ${browserResult.error?.code} != ${testCase.expected_browser_code}`);
    }
  }
  if (testCase.must_agree && testCase.expected_python_tuf === 'reject') {
    if (typeof testCase.expected_python_error !== 'string') {
      reasons.push('reject case names no expected_python_error');
    } else if (pythonErrorName !== testCase.expected_python_error) {
      reasons.push(`python-tuf error ${pythonErrorName} != ${testCase.expected_python_error}`);
    }
    if (typeof testCase.positive_control !== 'string') {
      reasons.push('reject case names no positive_control');
    }
  }
  if (reasons.length > 0) pass = false;

  rows.push({
    name: testCase.name,
    class: testCase.must_agree ? 'conformance' : 'profile-observation',
    browser: browserResult.decision,
    python_tuf: pythonResult.decision,
    expected_browser: testCase.expected_browser,
    expected_python_tuf: testCase.expected_python_tuf,
    agrees,
    pass,
    browser_error: browserResult.error,
    python_error: pythonResult.error,
    expected_python_error: testCase.expected_python_error ?? null,
    expected_browser_code: testCase.expected_browser_code ?? null,
    positive_control: testCase.positive_control ?? null,
    oracle_misuse: oracleMisuse,
    reasons,
    note: testCase.note,
  });
}

// Positive controls (A7-R14). The control must be an accept case that drives both
// oracles through the same setup as the rejection (same trusted root, same
// preloaded timestamp/snapshot, same trusted versions, same number of new roots),
// and both oracles must have accepted it. Otherwise an agreeing rejection could be
// an artefact of that setup (the 2026-11-16 RuntimeError came from the preload).
const SETUP_FIELDS = [
  'trusted_root_b64',
  'preload_timestamp_b64',
  'preload_snapshot_b64',
  'trusted_versions',
];
const caseByName = new Map(corpus.cases.map((testCase) => [testCase.name, testCase]));
const rowByName = new Map(rows.map((row) => [row.name, row]));
for (const row of rows) {
  const testCase = caseByName.get(row.name);
  if (typeof testCase.positive_control !== 'string') continue;
  const control = caseByName.get(testCase.positive_control);
  const controlRow = rowByName.get(testCase.positive_control);
  if (!control) {
    row.reasons.push(`positive control ${testCase.positive_control} is not in the corpus`);
  } else if (control.expected_browser !== 'accept' || control.must_agree !== true) {
    row.reasons.push(`positive control ${control.name} is not a conformance accept case`);
  } else if (
    SETUP_FIELDS.some(
      (field) => JSON.stringify(control[field] ?? null) !== JSON.stringify(testCase[field] ?? null),
    )
    || control.roots_b64.length !== testCase.roots_b64.length
  ) {
    row.reasons.push(`positive control ${control.name} has another oracle setup`);
  } else if (
    !controlRow.pass
    || controlRow.browser !== 'accept'
    || controlRow.python_tuf !== 'accept'
  ) {
    row.reasons.push(`positive control ${control.name} was not accepted by both oracles`);
  }
  if (row.reasons.length > 0) row.pass = false;
}
for (const row of rows) {
  if (!row.pass) failures += 1;
}

// #56: keyids recomputed by the oracle independently of the code under test.
// A missing check is a failure too, so the gate cannot pass by omission.
// The checked totals must equal what the corpus holds, recomputed here, so an
// oracle that checks fewer roots or keys (or none) cannot report success.
const corpusRoots = corpus.cases.flatMap(
  (testCase) => [testCase.trusted_root_b64, ...testCase.roots_b64],
);
const expectedRoots = corpusRoots.length;
const expectedKeys = corpusRoots.reduce((sum, raw) => sum + Object.keys(
  JSON.parse(Buffer.from(raw, 'base64').toString('utf8')).signed.keys,
).length, 0);
const keyidCheck = python.keyid_check;
const keyidCheckPassed = Boolean(keyidCheck)
  && keyidCheck.method === KEYID_METHOD
  && Array.isArray(keyidCheck.mismatches)
  && keyidCheck.mismatches.length === 0
  && expectedRoots > 0
  && keyidCheck.roots_checked === expectedRoots
  && keyidCheck.keys_checked === expectedKeys;
if (!keyidCheckPassed) failures += 1;

const report = {
  schema_version: 1,
  python_tuf_version: python.version,
  keyid_check: { passed: keyidCheckPassed, ...keyidCheck },
  summary: {
    cases: rows.length,
    conformance_cases: rows.filter((row) => row.class === 'conformance').length,
    profile_observations: rows.filter(
      (row) => row.class === 'profile-observation',
    ).length,
    keyid_check_passed: keyidCheckPassed,
    failures,
  },
  rows,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const row of rows) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'} ${row.name}: browser=${row.browser} python-tuf=${row.python_tuf} class=${row.class}`
    + (row.reasons.length > 0 ? ` reasons=${JSON.stringify(row.reasons)}` : ''),
  );
}
console.log(
  `${keyidCheckPassed ? 'PASS' : 'FAIL'} independent keyid check: `
  + `${keyidCheck?.roots_checked ?? 0}/${expectedRoots} roots, `
  + `${keyidCheck?.keys_checked ?? 0}/${expectedKeys} keys, `
  + `${keyidCheck?.mismatches?.length ?? 'missing'} mismatches`,
);
console.log(JSON.stringify(report.summary));

if (failures !== 0) {
  process.exitCode = 1;
}
