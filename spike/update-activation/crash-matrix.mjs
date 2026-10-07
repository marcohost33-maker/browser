#!/usr/bin/env node
// Crash matrix for the coupled update transaction: prints or writes the evidence report.
//
//   node spike/update-activation/crash-matrix.mjs                # print summary
//   node spike/update-activation/crash-matrix.mjs --write        # refresh results/crash-matrix-report.json
//   node spike/update-activation/crash-matrix.mjs --real-fs      # add process crashes on the real filesystem
//   node spike/update-activation/crash-matrix.mjs --real-fs-only # real filesystem only (cross-platform CI)
//
// The scenarios run through the activation store's crash matrix, so the persistence
// models, variants and invariants are exactly those of spike/activation-store. The
// committed report contains model results only (deterministic and platform-
// independent); real-filesystem runs depend on the host and are printed. The report is
// bound to every source that can change its numbers, including the TUF verifier.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runModelMatrix,
  runRealFsProcessCrashMatrix,
  VARIANTS,
} from '../activation-store/harness/crash-matrix.js';
import { COUPLED_SCENARIOS, TWO_COMMIT_CONTROL } from './harness/scenarios.js';

export const REPORT_SCHEMA = 'browser-update-activation/crash-matrix-report/v1';
export const MATRIX_CONFIG = Object.freeze({ samples: 12, postRecoverySamples: 4, seed: 20261007 });
export const SOURCE_FILES = Object.freeze([
  'update-activation.js',
  'harness/scenarios.js',
  'harness/tuf-repository.js',
  '../activation-store/activation-store.js',
  '../activation-store/harness/crash-matrix.js',
  '../activation-store/harness/fault-injection.js',
  '../activation-store/harness/model-fs.js',
  '../tuf-offline-metadata/tuf-offline.js',
  '../tuf-offline-metadata/strict-json.js',
]);

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPORT_PATH = path.join(here, 'results', 'crash-matrix-report.json');

export async function sourceDigests() {
  const digests = {};
  for (const file of SOURCE_FILES) {
    // Normalise line endings so a Windows checkout reproduces the same digests.
    const text = (await readFile(path.join(here, file), 'utf8')).replace(/\r\n/g, '\n');
    digests[file] = createHash('sha256').update(text, 'utf8').digest('hex');
  }
  return digests;
}

function totals(results) {
  let crashCases = 0;
  let consistent = 0;
  let durabilityViolations = 0;
  const kinds = new Set();
  for (const result of results) {
    durabilityViolations += result.durabilityViolations;
    for (const counter of Object.values(result.models)) {
      crashCases += counter.crashCases;
      consistent += counter.consistent;
      for (const example of counter.examples) for (const kind of example.violations) kinds.add(kind);
    }
  }
  return { crashCases, consistent, durabilityViolations, exampleViolations: [...kinds].sort() };
}

export async function buildReport(config = MATRIX_CONFIG) {
  const modelResults = await runModelMatrix({ ...config, scenarios: COUPLED_SCENARIOS, variants: VARIANTS });
  // The negative control runs without nested recovery checks: it must fail at the
  // first level already, and its numbers would only grow with the nested ones.
  const negativeControl = await runModelMatrix({
    ...config,
    scenarios: [TWO_COMMIT_CONTROL],
    variants: VARIANTS,
    nested: false,
  });
  const coupled = totals(modelResults);
  const control = totals(negativeControl);
  return {
    schema: REPORT_SCHEMA,
    sources: await sourceDigests(),
    config,
    summary: {
      modelCrashCases: coupled.crashCases,
      modelConsistent: coupled.consistent,
      modelRecoverySuccess: coupled.crashCases === 0 ? null : coupled.consistent / coupled.crashCases,
      durabilityViolations: coupled.durabilityViolations,
      negativeControl: {
        scenario: TWO_COMMIT_CONTROL.name,
        crashCases: control.crashCases,
        violations: control.crashCases - control.consistent,
        discriminating: control.consistent < control.crashCases,
        exampleViolations: control.exampleViolations,
      },
    },
    modelResults,
    negativeControl,
  };
}

export function serializeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function runRealFs() {
  let failed = false;
  for (const result of await runRealFsProcessCrashMatrix({ scenarios: COUPLED_SCENARIOS })) {
    const counter = result.processCrash;
    process.stdout.write(`real-fs ${result.scenario}: ${counter.consistent}/${counter.crashCases} consistent\n`);
    if (counter.consistent !== counter.crashCases || counter.crashCases === 0) {
      failed = true;
      process.stdout.write(`  ${JSON.stringify(counter.examples)}\n`);
    }
  }
  return failed;
}

async function main(argv) {
  if (argv.includes('--real-fs-only')) return (await runRealFs()) ? 1 : 0;
  const report = await buildReport();
  if (argv.includes('--write')) {
    await writeFile(REPORT_PATH, serializeReport(report));
    process.stdout.write(`wrote ${path.relative(process.cwd(), REPORT_PATH)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
  let failed = report.summary.modelConsistent !== report.summary.modelCrashCases
    || report.summary.durabilityViolations !== 0
    || !report.summary.negativeControl.discriminating;
  if (argv.includes('--real-fs')) failed = (await runRealFs()) || failed;
  return failed ? 1 : 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
