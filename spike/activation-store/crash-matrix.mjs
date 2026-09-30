#!/usr/bin/env node
// Runs the activation-store crash matrix and prints or writes the evidence report.
//
//   node spike/activation-store/crash-matrix.mjs                # print summary
//   node spike/activation-store/crash-matrix.mjs --write        # refresh results/crash-matrix-report.json
//   node spike/activation-store/crash-matrix.mjs --real-fs      # add process crashes on the real filesystem
//   node spike/activation-store/crash-matrix.mjs --real-fs-only # real filesystem only (cross-platform CI)
//
// The committed report contains only model results: they are deterministic and
// platform-independent, so any reviewer can reproduce them byte for byte. Real
// filesystem runs depend on the host and are printed, not committed.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runModelMatrix,
  runNegativeControls,
  runRealFsProcessCrashMatrix,
  summarize,
} from './harness/crash-matrix.js';

export const REPORT_SCHEMA = 'browser-activation/crash-matrix-report/v1';
export const MATRIX_CONFIG = Object.freeze({ samples: 12, postRecoverySamples: 4, seed: 20260927 });
export const SOURCE_FILES = Object.freeze([
  'activation-store.js',
  'node-io.js',
  'harness/crash-matrix.js',
  'harness/fault-injection.js',
  'harness/model-fs.js',
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

export async function buildReport(config = MATRIX_CONFIG) {
  const modelResults = await runModelMatrix(config);
  const negativeControls = await runNegativeControls({ samples: config.samples, seed: config.seed });
  return {
    schema: REPORT_SCHEMA,
    sources: await sourceDigests(),
    config,
    summary: summarize(modelResults, negativeControls),
    modelResults,
    negativeControls,
  };
}

export function serializeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

async function runRealFs() {
  let failed = false;
  for (const result of await runRealFsProcessCrashMatrix()) {
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
  for (const control of report.negativeControls) {
    process.stdout.write(`negative control ${control.name}: ${control.discriminating ? 'detected' : 'NOT DETECTED'}\n`);
  }
  let failed = report.summary.modelConsistent !== report.summary.modelCrashCases
    || report.summary.durabilityViolations !== 0
    || report.negativeControls.some((control) => !control.discriminating);
  if (argv.includes('--real-fs')) failed = (await runRealFs()) || failed;
  return failed ? 1 : 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
