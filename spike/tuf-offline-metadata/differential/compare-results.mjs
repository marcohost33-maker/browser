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

const byName = (result) => new Map(
  result.results.map((item) => [item.name, item]),
);
const browserByName = byName(browser);
const pythonByName = byName(python);

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
  if (!pass) failures += 1;

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
    note: testCase.note,
  });
}

const report = {
  schema_version: 1,
  python_tuf_version: python.version,
  summary: {
    cases: rows.length,
    conformance_cases: rows.filter((row) => row.class === 'conformance').length,
    profile_observations: rows.filter(
      (row) => row.class === 'profile-observation',
    ).length,
    failures,
  },
  rows,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const row of rows) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'} ${row.name}: browser=${row.browser} python-tuf=${row.python_tuf} class=${row.class}`,
  );
}
console.log(JSON.stringify(report.summary));

if (failures !== 0) {
  process.exitCode = 1;
}
