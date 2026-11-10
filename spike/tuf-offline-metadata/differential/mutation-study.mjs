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
const CLIENT = `${SPIKE}/client/client-core.mjs`;
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
  // --- stateful client: trusted-state boundary (P2-BR59-01) ----------------
  {
    id: 'client-load-skips-secure-directory',
    description: 'loadTrustedState() uses the requested path unchecked',
    file: CLIENT,
    // The check runs inside each read attempt since BR64-02 (readSettledTrustedState).
    find: '      const metadataDir = await secureMetadataDir(requestedDir);',
    replace: '      const metadataDir = resolve(requestedDir); // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-init-skips-secure-directory',
    description: 'initClient() bootstraps into the requested path unchecked',
    file: CLIENT,
    find: 'export async function initClient(requestedDir, trustedRootPath, limits = DEFAULT_LIMITS) {',
    replace: 'export async function initClient(requestedDir, trustedRootPath, limits = DEFAULT_LIMITS) { const secureMetadataDir = async (dir) => resolve(dir); // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-entry-group-write-ignored',
    description: 'trusted directory/files: only the world-write bit is refused',
    file: CLIENT,
    find: "  if (posix && (stat.mode & 0o022) !== 0) return 'is writable by group or others';",
    replace: "  if (posix && (stat.mode & 0o002) !== 0) return 'is writable by group or others'; // MUTANT",
    detectableBy: ['unit'],
  },
  {
    id: 'client-entry-owner-ignored',
    description: 'trusted directory/files: a foreign owner is accepted',
    file: CLIENT,
    find: "  if (uid !== null && stat.uid !== uid) return 'is owned by another account';",
    replace: '  // MUTANT: owner check removed',
    detectableBy: ['unit'],
  },
  {
    id: 'client-entry-type-ignored',
    description: 'trusted directory/files: links and special files are accepted',
    file: CLIENT,
    find: '  if (directory ? !stat.isDirectory() : !stat.isFile()) {',
    replace: '  if (false) { // MUTANT: type rule removed',
    detectableBy: ['unit'],
  },
  {
    id: 'client-ancestor-walk-removed',
    description: 'directories above the trusted state are not checked',
    file: CLIENT,
    find: '      if (problem !== null) insecure(`ancestor directory ${ancestor}`, problem, ancestor, stat);',
    replace: '      // MUTANT: ancestor problems ignored',
    detectableBy: ['unit'],
  },
  {
    id: 'client-ancestor-sticky-refused',
    description: 'a sticky, world-writable ancestor such as /tmp is refused',
    file: CLIENT,
    find: '  if ((stat.mode & 0o022) !== 0 && (stat.mode & STICKY_BIT) === 0) {',
    replace: '  if ((stat.mode & 0o022) !== 0) { // MUTANT: sticky exception removed',
    detectableBy: ['unit'],
  },
  {
    id: 'client-ancestor-write-ignored',
    description: 'an ancestor that others can write without the sticky bit is accepted',
    file: CLIENT,
    find: '  if ((stat.mode & 0o022) !== 0 && (stat.mode & STICKY_BIT) === 0) {',
    replace: '  if (false) { // MUTANT: ancestor write bits ignored',
    detectableBy: ['unit'],
  },
  {
    id: 'client-ancestor-owner-ignored',
    description: 'an ancestor owned by another (non-superuser) account is accepted',
    file: CLIENT,
    find: "  if (uid !== null && stat.uid !== uid && stat.uid !== 0) return 'is owned by another account';",
    replace: '  // MUTANT: ancestor owner check removed',
    detectableBy: ['unit'],
  },
  {
    id: 'client-io-through-requested-path',
    description: 'IO keeps using the requested path instead of the checked canonical one',
    file: CLIENT,
    find: '    directory = join(canonicalExisting, ...missing);',
    replace: '    directory = absolute; // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-mkdir-not-private',
    description: 'missing directories are created with the default (umask) mode',
    file: CLIENT,
    find: '  await mkdir(parent, { recursive: true, mode: 0o700 });',
    replace: '  await mkdir(parent, { recursive: true }); // MUTANT',
    detectableBy: ['unit'],
  },
  // --- stateful client: 5.3.11 reset marker (#57/#59, C5, C6) ---------------
  {
    id: 'client-marker-keeps-targets-floor',
    description: 'under a reset the retained targets.json still sets the targets floor',
    file: CLIENT,
    find: '        targets: retainedTargets?.signed.version ?? 0,',
    replace: '        targets: rollbackStateReset && targets !== null ? targets.signed.version : (retainedTargets?.signed.version ?? 0), // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-marker-names-new-root',
    description: 'C5 reverted: a pending reset is re-tied to the new root',
    file: CLIENT,
    find: '    return local.rollbackStateReset.resetPendingSinceRoot ?? local.parsed.root.signed.version;',
    replace: '    return verified.trustedRoot.signed.version; // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-marker-never-written',
    description: 'a refresh under a reset does not write the reset marker',
    file: CLIENT,
    find: '  if (complete && rollbackReset) {',
    replace: '  if (false) { // MUTANT: marker never written',
    detectableBy: ['unit'],
  },
  {
    id: 'client-marker-never-removed',
    description: 'the reset marker stays after a complete refresh',
    file: CLIENT,
    find: '    if (rollbackReset) {',
    replace: '    if (false) { // MUTANT: marker never removed',
    detectableBy: ['unit'],
  },
  {
    id: 'client-marker-removed-before-targets',
    description: 'the reset marker comes off before targets.json is down',
    file: CLIENT,
    find: "    writes.push(await atomicWriteFile(rolePath(metadataDir, 'targets'), bundle.targets));",
    replace: "    if (rollbackReset) await removeRollbackResetMarker(metadataDir); writes.push(await atomicWriteFile(rolePath(metadataDir, 'targets'), bundle.targets)); // MUTANT",
    detectableBy: ['unit'],
  },
  {
    id: 'client-marker-removed-before-snapshot',
    description: 'the reset marker comes off before snapshot.json is down',
    file: CLIENT,
    find: "    writes.push(await atomicWriteFile(rolePath(metadataDir, 'snapshot'), bundle.snapshot));",
    replace: "    if (rollbackReset) await removeRollbackResetMarker(metadataDir); writes.push(await atomicWriteFile(rolePath(metadataDir, 'snapshot'), bundle.snapshot)); // MUTANT",
    detectableBy: ['unit'],
  },
  {
    id: 'client-read-identity-ignored',
    description: 'the descriptor is read even if it is another object than the one checked',
    file: CLIENT,
    find: '    if (!sameObject(before, opened)) {',
    replace: '    if (false) { // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-read-identity-dev-only',
    description: 'object identity compares the device but not the inode',
    file: CLIENT,
    find: '  return left.dev === right.dev && left.ino === right.ino;',
    replace: '  return left.dev === right.dev; // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-read-descriptor-unchecked',
    description: 'the account rule is not repeated on the open descriptor',
    file: CLIENT,
    find: "    checkEntry(opened, 'on the open descriptor');",
    replace: '    // MUTANT: no check on the descriptor',
    detectableBy: ['unit'],
  },
  {
    id: 'client-read-change-ignored',
    description: 'a change of the file while it is read goes unnoticed',
    file: CLIENT,
    find: '    if (contentStamp(after) !== contentStamp(opened)) {',
    replace: '    if (false) { // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-read-stamp-ignores-ctime',
    description: 'a status change or a replacement during the read goes unnoticed',
    file: CLIENT,
    find: '  return `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;',
    replace: '  return `${stat.size}:${stat.mtimeNs}`; // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-read-twice-by-path',
    description: 'the returned bytes come from a second read of the path',
    file: CLIENT,
    find: '    return bytes;',
    replace: '    return await readFile(path); // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-read-directory-swap-ignored',
    description: 'role files of two directory instances are accepted as one state',
    file: CLIENT,
    find: '  if (directoryAfter === null || !sameObject(directoryBefore, directoryAfter)) {',
    replace: '  if (false) { // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-readback-digest-ignored',
    description: 'a valid chain on disk counts even if it is not the verified one',
    file: CLIENT,
    find: '    if (bytes !== undefined && readBack.sha256[role] !== sha256(bytes)) {',
    replace: '    if (false) { // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-readback-incomplete-accepted',
    description: 'the read-back does not refuse a state under reset or with unpinned targets',
    file: CLIENT,
    find: '  if (state.rollbackStateReset !== null || state.targetsUnpinned',
    replace: '  if (false // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-download-from-unverified-state',
    description: 'a download authorises from a state it read but did not verify',
    file: CLIENT,
    find: '  const { state: local } = await loadVerifiedChain(metadataDir, now, limits);',
    replace: '  const local = await loadTrustedState(metadataDir, limits); // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-load-ignores-pending-reset',
    description: 'a pending reset marker no longer clears the floors on load',
    file: CLIENT,
    find: '  const rollbackStateReset = rotatedOut.length > 0 || resetPendingSinceRoot !== null;',
    replace: '  const rollbackStateReset = rotatedOut.length > 0; // MUTANT',
    detectableBy: ['unit'],
  },
  // --- process kills (BR64-04): judged by tests/tuf/tuf-client-process-kill.test.js,
  // which runs only for mutants that set BROWSER_TUF_KILL_MATRIX (time budget).
  {
    id: 'client-write-in-place',
    description: 'atomicWriteFile truncates and rewrites the target instead of renaming the temp over it',
    file: CLIENT,
    find: '    await rename(tempPath, path);',
    replace: "    { const target = await open(path, 'w', 0o600); await target.writeFile(data); await target.sync(); await target.close(); await unlink(tempPath); } // MUTANT",
    env: { BROWSER_TUF_KILL_MATRIX: '1' },
    detectableBy: ['unit'],
  },
  {
    id: 'client-stale-temps-kept',
    description: 'a refresh no longer sweeps the temp files of a killed refresh',
    file: CLIENT,
    find: '  const staleTempsRemoved = await sweepStaleTempFiles(metadataDir);',
    replace: '  const staleTempsRemoved = []; // MUTANT',
    env: { BROWSER_TUF_KILL_MATRIX: '1' },
    detectableBy: ['unit'],
  },
  {
    id: 'client-sweep-ignores-liveness',
    description: 'the sweep removes temp files of processes that are still running',
    file: CLIENT,
    find: '    if (!Number.isSafeInteger(pid) || pid < 1 || processMayBeAlive(pid)) continue;',
    replace: '    if (!Number.isSafeInteger(pid) || pid < 1) continue; // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-sweep-follows-any-entry',
    description: 'the sweep removes links and directories that carry a temp name',
    file: CLIENT,
    find: '    if (entry === null || !entry.isFile()) continue;',
    replace: '    if (entry === null) continue; // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-load-retry-accepts-changed-state',
    description: 'after the last attempt a refused concurrent change is accepted instead of thrown',
    file: CLIENT,
    find: '        error.details = { ...(error.details ?? {}), attempts: attempt };',
    replace: '        return { metadataDir: resolve(requestedDir), ...(await readTrustedRoleFiles(resolve(requestedDir), limits)), attempts: attempt }; // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-load-retries-insecure-state',
    description: 'INSECURE_LOCAL_STATE is retried like a concurrent change',
    file: CLIENT,
    find: "      if (error?.code !== 'LOCAL_STATE_CHANGED') throw error;",
    replace: "      if (error?.code !== 'LOCAL_STATE_CHANGED' && error?.code !== 'INSECURE_LOCAL_STATE') throw error; // MUTANT",
    detectableBy: ['unit'],
  },
  {
    id: 'client-load-retry-reuses-directory-check',
    description: 'a retry skips the boundary check of the (possibly replaced) directory',
    file: CLIENT,
    find: '      const metadataDir = await secureMetadataDir(requestedDir);',
    replace: '      const metadataDir = attempt > 1 ? resolve(requestedDir) : await secureMetadataDir(requestedDir); // MUTANT',
    detectableBy: ['unit'],
  },
  {
    id: 'client-readback-leaks-verifier-code',
    description: 'a mixed state on disk is refused with the verifier code, not PERSISTED_STATE_UNVERIFIED',
    file: CLIENT,
    find: "    if (typeof error?.code !== 'string') throw error;",
    replace: '    throw error; // MUTANT',
    env: { BROWSER_TUF_KILL_MATRIX: '1' },
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
function childEnv(extra = {}) {
  const env = { ...process.env, BROWSER_TUF_MUTATION_STUDY: '1', ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: childEnv(extraEnv),
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

function unitDetector(root, extraEnv = {}) {
  const result = run(
    process.execPath,
    ['--test', '--test-reporter=tap', 'tests/tuf/*.test.js'],
    root,
    extraEnv,
  );
  return {
    exit: result.status,
    tests: tapCount(result.stdout, 'tests'),
    fail: tapCount(result.stdout, 'fail'),
    // Top-level TAP lines only: the names of the tests that caught the mutant.
    failed_tests: [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]),
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

function evaluate(root, options, baseline, extraEnv = {}) {
  const detectors = {};
  const kills = [];
  const crashes = [];
  if (options.detectors.includes('unit')) {
    const unit = unitDetector(root, extraEnv);
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
        ...(mutant.env ? { env: mutant.env } : {}),
      };
      if (!evaluable) {
        report.mutants.push({ ...entry, status: 'not-evaluated' });
        continue;
      }
      const root = makeCopy();
      try {
        Object.assign(entry, applyMutant(root, mutant));
        const result = evaluate(root, options, baseline.detectors, mutant.env ?? {});
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
