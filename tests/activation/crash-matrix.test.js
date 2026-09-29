// Crash-matrix gates for the activation store.
//
// The default run covers every crash point of every scenario under every persistence
// model, nested recovery checks for the small scenarios, the negative controls and real
// filesystem process crashes for a subset. The committed evidence report is bound to
// the exact source digests. Set ACTIVATION_MATRIX_FULL=1 to rebuild the full report
// and require byte equality with the committed file.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  NEGATIVE_CONTROLS,
  runModelMatrix,
  runNegativeControls,
  runRealFsProcessCrashMatrix,
  SCENARIOS,
  VARIANTS,
} from '../../spike/activation-store/harness/crash-matrix.js';
import {
  buildReport,
  MATRIX_CONFIG,
  REPORT_PATH,
  REPORT_SCHEMA,
  serializeReport,
  sourceDigests,
} from '../../spike/activation-store/crash-matrix.mjs';

function assertNoViolations(results) {
  for (const result of results) {
    assert.equal(result.durabilityViolations, 0, `${result.variant}/${result.scenario}: durability`);
    for (const [model, counter] of Object.entries(result.models)) {
      assert.ok(counter.crashCases > 0, `${result.variant}/${result.scenario}/${model}: nothing was exercised`);
      assert.equal(counter.consistent, counter.crashCases, `${result.variant}/${result.scenario}/${model}: ${JSON.stringify(counter.examples)}`);
    }
  }
}

test('every crash point of every scenario recovers to exactly the old or the new state', async () => {
  const results = await runModelMatrix({ nested: false, samples: 4 });
  assert.equal(results.length, SCENARIOS.length * VARIANTS.length);
  assertNoViolations(results);
  const unsynced = results.filter((result) => result.scenario === 'activate-after-unsynced-staging');
  assert.equal(unsynced.length, VARIANTS.length, 'the commit-side barrier scenario runs under every variant');
});

test('recovery survives its own crashes and makes the recovered state durable', async () => {
  const results = await runModelMatrix({
    scenarios: SCENARIOS.filter((scenario) => ['create-store', 'rollback', 'bind-metadata'].includes(scenario.name)),
    samples: 2,
    postRecoverySamples: 2,
  });
  assertNoViolations(results);
  for (const result of results) {
    assert.ok(result.models['recovery-crash'].crashCases > 0, `${result.scenario}: recovery crashes exercised`);
  }
});

test('negative controls: dropping any fsync is detected by the matrix', async () => {
  const controls = await runNegativeControls({ samples: 2 });
  assert.equal(controls.length, NEGATIVE_CONTROLS.length);
  assert.equal(controls.length, 4);
  for (const control of controls) {
    assert.equal(control.discriminating, true, `${control.name} was not detected`);
  }
  const publishedFile = controls.find((control) => control.name === 'unsynced-published-file');
  assert.equal(publishedFile.variant, 'no-directory-sync');
  assert.ok(publishedFile.models['ordered-prefix'].violationCount > 0, 'the file barrier is load-bearing without directory sync');
  const objectDirectories = controls.find((control) => control.name === 'unsynced-object-directories');
  assert.ok(objectDirectories.models['posix-strict'].violationCount > 0);
  assert.equal(
    objectDirectories.models['ordered-prefix'].violationCount,
    0,
    'an ordered metadata journal masks this omission; only the posix-strict model can expose it',
  );
});

test('process crashes on the real filesystem recover consistently', async () => {
  const results = await runRealFsProcessCrashMatrix({
    scenarios: SCENARIOS.filter((scenario) => ['rollback', 'bind-metadata', 'activate-after-unsynced-staging'].includes(scenario.name)),
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
    'sources changed: run `node spike/activation-store/crash-matrix.mjs --write` and commit the report',
  );
  assert.equal(report.summary.modelRecoverySuccess, 1);
  assert.equal(report.summary.modelConsistent, report.summary.modelCrashCases);
  assert.equal(report.summary.durabilityViolations, 0);
  assert.equal(report.summary.negativeControlsDiscriminating, '4/4');
});

test('full matrix reproduces the committed report byte for byte', {
  skip: process.env.ACTIVATION_MATRIX_FULL === '1' ? false : 'set ACTIVATION_MATRIX_FULL=1 to rebuild the full report',
}, async () => {
  const committed = await readFile(REPORT_PATH, 'utf8');
  assert.equal(serializeReport(await buildReport()), committed);
});
