#!/usr/bin/env node
// Source-bound mutation study for the TUF spike (#59 review).
//
// Each mutant is one exact, anchored edit of a guard in the code under test.
// Anchors carry no line ending, so the study works on LF and CRLF checkouts.
// The study copies spike/tuf-offline-metadata and tests/tuf into a temporary
// root, applies the edit there (never in the checkout) and runs the selected
// detectors against the copy:
//
//   unit          node --test tests/tuf/*.test.js on the copy
//   differential  corpus -> Browser oracle, every decision vs. expected_browser
//   python        the same corpus through python_tuf_oracle.py and
//                 compare-results.mjs (needs --python <interpreter>)
//
// A mutant counts as killed only by a detector that ran to completion and
// reported a decision or test failure. A crash (syntax error, generator or
// oracle exit != 0, fewer unit tests than the baseline) is reported as such
// and is NOT a kill, so a broken edit cannot pass for a detected one.
//
// Usage:
//   node mutation-study.mjs <report.json> [--python <exe>]
//        [--detectors unit,differential,python] [--mutants id,id]
//        [--require-all]
// Exit 1 if the baseline is not clean, an evaluated mutant survives, a mutant
// crashes, or (with --require-all) a mutant could not be evaluated because its
// detector was not selected.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SPIKE = 'spike/tuf-offline-metadata';
const DIFF = `${SPIKE}/differential`;
const ALL_DETECTORS = ['unit', 'differential', 'python'];

export const MUTANTS = Object.freeze([
  {
    id: 'role-binding-removed',
    description: 'verifyRoleSignatures counts any key in root.keys (role.keyids check removed)',
    file: `${SPIKE}/tuf-offline.js`,
    find: '    if (!role.keyids.includes(signature.keyid)) continue;',
    replace: '    // MUTANT: role.keyids check removed',
    detectableBy: ['unit', 'differential', 'python'],
  },
  {
    id: 'role-binding-skipped-for-root',
    description: 'verifyRoleSignatures skips the role.keyids check for the root role only',
    file: `${SPIKE}/tuf-offline.js`,
    find: '    if (!role.keyids.includes(signature.keyid)) continue;',
    replace: "    if (roleName !== 'root' && !role.keyids.includes(signature.keyid)) continue;",
    detectableBy: ['unit', 'differential', 'python'],
  },
  {
    id: 'keyid-non-canonical',
    description: 'keyIdFor hashes JSON.stringify(key) instead of the canonical encoding',
    file: `${SPIKE}/tuf-offline.js`,
    find: '  return sha256(canonicalBytes(key, limits));',
    replace: '  return sha256(Buffer.from(JSON.stringify(key), \'utf8\'));',
    // Self-consistent drift: corpus and verifier share keyIdFor, so only the
    // independent python keyid recomputation can see it.
    detectableBy: ['python'],
  },
  {
    id: 'retained-version-binding-removed',
    description: 'verifyRetainedMetadataDescriptor no longer compares the descriptor version',
    file: `${SPIKE}/tuf-offline.js`,
    find: '  if (metadata.signed?.version !== descriptor.version) {',
    replace: '  if (false) { // MUTANT: version binding removed',
    detectableBy: ['unit'],
  },
]);

function parseArgs(argv) {
  const options = {
    report: null,
    python: null,
    detectors: null,
    mutants: null,
    requireAll: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--python') options.python = value();
    else if (arg === '--detectors') options.detectors = value().split(',');
    else if (arg === '--mutants') options.mutants = value().split(',');
    else if (arg === '--require-all') options.requireAll = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else if (options.report === null) options.report = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (!options.report) throw new Error('usage: node mutation-study.mjs <report.json> [options]');
  options.detectors ??= options.python ? ALL_DETECTORS : ['unit', 'differential'];
  for (const detector of options.detectors) {
    if (!ALL_DETECTORS.includes(detector)) throw new Error(`unknown detector ${detector}`);
  }
  if (options.detectors.includes('python') && !options.python) {
    throw new Error('the python detector needs --python <interpreter>');
  }
  if (options.detectors.length === 0) throw new Error('no detector selected');
  const known = new Set(MUTANTS.map((mutant) => mutant.id));
  for (const id of options.mutants ?? []) {
    if (!known.has(id)) throw new Error(`unknown mutant ${id}`);
  }
  return options;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// A nested `node --test` inherits NODE_TEST_CONTEXT from a parent test run and
// would then report to the parent instead of printing its own TAP summary.
// BROWSER_TUF_MUTATION_STUDY lets the copied tests skip the tests that run this
// study themselves, so a mutant is judged by the suite, not by a nested study.
function childEnv() {
  const env = { ...process.env, BROWSER_TUF_MUTATION_STUDY: '1' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: childEnv(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function makeCopy() {
  const root = mkdtempSync(join(tmpdir(), 'browser-tuf-mutation-'));
  for (const path of [SPIKE, 'tests/tuf']) {
    cpSync(join(REPO, path), join(root, path), { recursive: true });
  }
  return root;
}

function applyMutant(root, mutant) {
  const path = join(root, mutant.file);
  const source = readFileSync(path, 'utf8');
  const occurrences = source.split(mutant.find).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `mutant ${mutant.id}: anchor occurs ${occurrences} times in ${mutant.file}, expected exactly 1`,
    );
  }
  const mutated = source.replace(mutant.find, mutant.replace);
  writeFileSync(path, mutated);
  return { original_sha256: sha256(source), mutated_sha256: sha256(mutated) };
}

function tapCount(stdout, name) {
  const match = new RegExp(`^# ${name} (\\d+)$`, 'm').exec(stdout);
  return match ? Number(match[1]) : null;
}

function unitDetector(root) {
  const result = run(
    process.execPath,
    ['--test', '--test-reporter=tap', 'tests/tuf/*.test.js'],
    root,
  );
  return {
    exit: result.status,
    tests: tapCount(result.stdout, 'tests'),
    fail: tapCount(result.stdout, 'fail'),
  };
}

function differentialDetector(root, work, python) {
  const corpus = join(work, 'corpus.json');
  const browser = join(work, 'browser-results.json');
  const generated = run(process.execPath, [`${DIFF}/generate-corpus.mjs`, corpus], root);
  if (generated.status !== 0) return { crashed: 'generate-corpus', stderr: generated.stderr.slice(-2000) };
  const oracle = run(process.execPath, [`${DIFF}/browser-oracle.mjs`, corpus, browser], root);
  if (oracle.status !== 0) return { crashed: 'browser-oracle', stderr: oracle.stderr.slice(-2000) };

  const cases = JSON.parse(readFileSync(corpus, 'utf8')).cases;
  const decisions = new Map(
    JSON.parse(readFileSync(browser, 'utf8')).results.map((item) => [item.name, item.decision]),
  );
  const browserMismatches = cases
    .filter((testCase) => decisions.get(testCase.name) !== testCase.expected_browser)
    .map((testCase) => testCase.name);
  const out = { cases: cases.length, browser_mismatches: browserMismatches };
  if (!python) return out;

  const pythonResults = join(work, 'python-tuf-results.json');
  const comparison = join(work, 'comparison.json');
  const pyRun = run(python, [`${DIFF}/python_tuf_oracle.py`, corpus, pythonResults], root);
  if (pyRun.status !== 0) return { ...out, crashed: 'python-tuf-oracle', stderr: pyRun.stderr.slice(-2000) };
  const compared = run(
    process.execPath,
    [`${DIFF}/compare-results.mjs`, corpus, browser, pythonResults, comparison],
    root,
  );
  let report = null;
  try {
    report = JSON.parse(readFileSync(comparison, 'utf8'));
  } catch {
    return { ...out, crashed: 'compare-results', stderr: compared.stderr.slice(-2000) };
  }
  return {
    ...out,
    compare_exit: compared.status,
    compare_failures: report.summary.failures,
    keyid_mismatches: report.keyid_check?.mismatches?.length ?? null,
  };
}

function evaluate(root, options, baseline) {
  const detectors = {};
  const kills = [];
  const crashes = [];
  if (options.detectors.includes('unit')) {
    const unit = unitDetector(root);
    detectors.unit = unit;
    if (unit.tests === null || unit.fail === null || (baseline && unit.tests !== baseline.unit.tests)) {
      crashes.push('unit');
    } else if (unit.fail > 0) {
      kills.push('unit');
    }
  }
  const wantsDifferential = options.detectors.includes('differential');
  const wantsPython = options.detectors.includes('python');
  if (wantsDifferential || wantsPython) {
    const work = join(root, 'out');
    mkdirSync(work, { recursive: true });
    const diff = differentialDetector(root, work, wantsPython ? options.python : null);
    if (diff.crashed) {
      crashes.push(diff.crashed);
    } else {
      if (wantsDifferential) detectors.differential = { cases: diff.cases, browser_mismatches: diff.browser_mismatches };
      if (wantsDifferential && diff.browser_mismatches.length > 0) kills.push('differential');
      if (wantsPython) {
        detectors.python = {
          compare_exit: diff.compare_exit,
          compare_failures: diff.compare_failures,
          keyid_mismatches: diff.keyid_mismatches,
        };
        if (diff.compare_exit !== 0 && diff.compare_failures > 0) kills.push('python');
      }
    }
    if (diff.crashed) detectors.crash = { stage: diff.crashed, stderr: diff.stderr };
  }
  return { detectors, kills, crashes };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const selected = MUTANTS.filter((mutant) => !options.mutants || options.mutants.includes(mutant.id));
  const report = {
    schema_version: 1,
    node: process.version,
    detectors: options.detectors,
    sources: {},
    baseline: null,
    mutants: [],
    summary: null,
  };

  const baseRoot = makeCopy();
  try {
    for (const mutant of MUTANTS) {
      report.sources[mutant.file] ??= sha256(readFileSync(join(baseRoot, mutant.file)));
    }
    const baseline = evaluate(baseRoot, options, null);
    // An empty run (no unit test or no corpus case found) would make every
    // mutant look like a survivor or, worse, make the study vacuous.
    const ran = (!baseline.detectors.unit || baseline.detectors.unit.tests > 0)
      && (!baseline.detectors.differential || baseline.detectors.differential.cases > 0);
    const clean = ran && baseline.crashes.length === 0 && baseline.kills.length === 0;
    report.baseline = { clean, ...baseline };
    if (!clean) {
      report.summary = { baseline_clean: false };
      writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
      console.error('baseline is not clean; no mutant evaluated');
      return 1;
    }

    for (const mutant of selected) {
      const evaluable = mutant.detectableBy.some((d) => options.detectors.includes(d));
      const entry = {
        id: mutant.id,
        description: mutant.description,
        file: mutant.file,
        detectable_by: mutant.detectableBy,
      };
      if (!evaluable) {
        report.mutants.push({ ...entry, status: 'not-evaluated' });
        continue;
      }
      const root = makeCopy();
      try {
        Object.assign(entry, applyMutant(root, mutant));
        const result = evaluate(root, options, baseline.detectors);
        let status = 'survived';
        if (result.crashes.length > 0) status = 'crashed';
        else if (result.kills.length > 0) status = 'killed';
        report.mutants.push({ ...entry, status, killed_by: result.kills, crashes: result.crashes, detectors: result.detectors });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  } finally {
    rmSync(baseRoot, { recursive: true, force: true });
  }

  const count = (status) => report.mutants.filter((m) => m.status === status).length;
  report.summary = {
    baseline_clean: true,
    mutants: report.mutants.length,
    killed: count('killed'),
    survived: count('survived'),
    crashed: count('crashed'),
    not_evaluated: count('not-evaluated'),
  };
  writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  for (const mutant of report.mutants) {
    console.log(`${mutant.status.toUpperCase()} ${mutant.id}${mutant.killed_by?.length ? ` by ${mutant.killed_by.join('+')}` : ''}`);
  }
  console.log(JSON.stringify(report.summary));

  const failed = report.summary.survived > 0
    || report.summary.crashed > 0
    || report.summary.mutants === 0
    || (options.requireAll && report.summary.not_evaluated > 0);
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
