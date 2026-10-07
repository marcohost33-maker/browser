// Crash-matrix gates for the coupled update transaction.
//
// The default run covers every crash point of every coupled scenario under every
// persistence model and platform variant, nested recovery crashes for the small
// scenarios, the two-commit negative control and real-filesystem process crashes for
// a subset. The committed evidence report is bound to the exact source digests. Set
// UPDATE_MATRIX_FULL=1 to rebuild the full report and require byte equality.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  runModelMatrix,
  runRealFsProcessCrashMatrix,
  VARIANTS,
} from '../../spike/activation-store/harness/crash-matrix.js';
import {
  buildReport,
  MATRIX_CONFIG,
  REPORT_PATH,
  REPORT_SCHEMA,
  serializeReport,
  sourceDigests,
} from '../../spike/update-activation/crash-matrix.mjs';
import { COUPLED_SCENARIOS, TWO_COMMIT_CONTROL } from '../../spike/update-activation/harness/scenarios.js';

function assertNoViolations(results) {
  for (const result of results) {
    assert.equal(result.durabilityViolations, 0, `${result.variant}/${result.scenario}: durability`);
    for (const [model, counter] of Object.entries(result.models)) {
      assert.ok(counter.crashCases > 0, `${result.variant}/${result.scenario}/${model}: nothing was exercised`);
      assert.equal(counter.consistent, counter.crashCases, `${result.variant}/${result.scenario}/${model}: ${JSON.stringify(counter.examples)}`);
    }
  }
}

test('every crash point of every coupled update recovers to exactly the old or the new state', async () => {
  const results = await runModelMatrix({ scenarios: COUPLED_SCENARIOS, nested: false, samples: 2 });
  assert.equal(results.length, COUPLED_SCENARIOS.length * VARIANTS.length);
  assertNoViolations(results);
});

test('recovery survives its own crashes and keeps the recovered update state durable', async () => {
  const results = await runModelMatrix({
    scenarios: COUPLED_SCENARIOS.filter((scenario) => ['coupled-bootstrap', 'coupled-rollback'].includes(scenario.name)),
    samples: 2,
    postRecoverySamples: 2,
  });
  assertNoViolations(results);
  for (const result of results) {
    assert.ok(result.models['recovery-crash'].crashCases > 0, `${result.scenario}: recovery crashes exercised`);
  }
});

test('negative control: committing metadata and package separately is detected as a mixed state', async () => {
  const results = await runModelMatrix({ scenarios: [TWO_COMMIT_CONTROL], nested: false, samples: 2 });
  for (const result of results) {
    const process = result.models['process-crash'];
    assert.ok(process.violationCount > 0, `${result.variant}: the two-commit protocol must be caught`);
    for (const counter of Object.values(result.models)) {
      for (const example of counter.examples) {
        assert.deepEqual(example.violations, ['state-not-old-or-new'], `${result.variant}: ${JSON.stringify(example)}`);
      }
    }
  }
});

test('process crashes on the real filesystem recover consistently', async () => {
  const results = await runRealFsProcessCrashMatrix({
    scenarios: COUPLED_SCENARIOS.filter((scenario) => ['coupled-update-root-rotation', 'coupled-rollback'].includes(scenario.name)),
  });
  for (const result of results) {
    const counter = result.processCrash;
    assert.ok(counter.crashCases > 0);
    assert.equal(counter.consistent, counter.crashCases, `${result.scenario}: ${JSON.stringify(counter.examples)}`);
  }
});

test('the committed crash-matrix report is bound to the current sources', async () => {
  const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  assert.equal(report.schema, REPORT_SCHEMA);
  assert.deepEqual(report.config, MATRIX_CONFIG);
  assert.deepEqual(
    report.sources,
    await sourceDigests(),
    'sources changed: run `node spike/update-activation/crash-matrix.mjs --write` and commit the report',
  );
  assert.equal(report.summary.modelRecoverySuccess, 1);
  assert.equal(report.summary.modelConsistent, report.summary.modelCrashCases);
  assert.equal(report.summary.durabilityViolations, 0);
  assert.equal(report.summary.negativeControl.discriminating, true);
  assert.deepEqual(report.summary.negativeControl.exampleViolations, ['state-not-old-or-new']);
  assert.deepEqual(
    [...new Set(report.modelResults.map((result) => result.scenario))],
    COUPLED_SCENARIOS.map((scenario) => scenario.name),
  );
});

test('full matrix reproduces the committed report byte for byte', {
  skip: process.env.UPDATE_MATRIX_FULL === '1' ? false : 'set UPDATE_MATRIX_FULL=1 to rebuild the full report',
}, async () => {
  const committed = await readFile(REPORT_PATH, 'utf8');
  assert.equal(serializeReport(await buildReport()), committed);
});
