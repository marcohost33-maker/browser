// Crash matrices for `download` and its target cache (todo 2026-11-10, follow-up of
// BR64-04).
//
// The refresh matrices (tuf-client-process-kill.test.js, tuf-client-power-loss.test.js)
// stop at the metadata directory. A download goes on: it writes the verified target
// through its own temp file in the TARGET's directory, which is not trusted state
// and, until this test existed, was never swept. Here one real downloadTargets()
// process is killed with SIGKILL before every mutating or durability step of BOTH
// directories and after the last one; a fresh process observes what was left and then
// downloads again.
//
// Contract per crash state:
//   T1 the output path is absent (only if it was before), or byte-equal to the
//      previously verified target, or to the newly authorised one: never torn;
//   T2 a target is on disk only under the metadata that authorises it: the new
//      bytes never appear before the new chain is completely committed (the metadata
//      keeps K1/K2 of crash-matrix-support.mjs, old or new or refused);
//   T3 one download by a fresh process converges: new metadata verified offline, the
//      output is exactly the newly authorised bytes, and bytes that are already there
//      and correct are not fetched again;
//   T4 no temp file is left in the metadata directory or beside the target;
//   T5 a second download is a pure cache hit: no target request.
// Power loss (ALICE model, power-loss-model.mjs) on the target's directory adds
//   T6 once the download returned, every power-loss state holds the new bytes.
//
// Limits: process kills keep the page cache (order only); the power-loss model covers
// the entries of the target's existing directory, not the creation of new
// directories (for those, the trace must show a sync of every parent that gained an
// entry, checked below); one target per call.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  downloadTargets,
  initClient,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import { sha256 } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import {
  bundleMirror,
  chainWithTarget,
  corpusFixture,
  METADATA_URL,
} from './client-fixtures.mjs';
import {
  assertProtocolSteps,
  digests,
  encodeBundle,
  MATRIX_SKIP,
  NOW,
  readJsonLines,
  ROLES,
  runWorker,
  sameFiles,
  writeReport,
} from './crash-matrix-support.mjs';
import { powerLossStates } from './power-loss-model.mjs';

const TARGET_URL = 'https://repo.test/targets/';
const TARGET_NAME = 'artifacts/demo.bin';
const OLD_TARGET = Buffer.from('oracle-target-v2', 'utf8'); // the corpus descriptor
const NEW_TARGET = Buffer.from('oracle-target-v3-with-more-bytes', 'utf8');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

const pointLabel = (steps, killAt) => (killAt <= steps.length
  ? `before ${steps[killAt - 1]}`
  : `after ${steps.at(-1)}`);
const isTargetStep = (label) => /demo\.bin|artifacts|<target-dir>/.test(label);

function targetMirror(chain, targetBytes) {
  const metadata = bundleMirror(chain);
  return async (url) => {
    if (!String(url).startsWith(TARGET_URL)) return metadata(url);
    return new Response(targetBytes, {
      status: 200, headers: { 'content-length': String(targetBytes.length) },
    });
  };
}

/**
 * `first-download`: trusted metadata is current, nothing was ever downloaded, the
 * target directories do not exist. `update-replaces-cached-target`: the old target
 * is cached; one call brings new metadata and the new bytes.
 */
async function scenarios() {
  const fx = await corpusFixture('browser-tuf-download-crash-');
  const oldChain = { roots: [], timestamp: fx.timestamp, snapshot: fx.snapshot, targets: fx.targets };
  const newChain = { roots: [], ...chainWithTarget(fx, 3, TARGET_NAME, NEW_TARGET) };
  return {
    fx,
    list: [
      {
        name: 'first-download',
        cachedBefore: false,
        setup: oldChain, next: oldChain, oldTarget: null, newTarget: OLD_TARGET,
      },
      {
        name: 'update-replaces-cached-target',
        cachedBefore: true,
        setup: oldChain, next: newChain, oldTarget: OLD_TARGET, newTarget: NEW_TARGET,
      },
    ],
  };
}

async function prepare(fx, scenario, prefix) {
  const base = await mkdtemp(join(tmpdir(), `browser-tuf-${prefix}-${scenario.name}-`));
  const template = join(base, 'template');
  const metadataDir = join(template, 'metadata');
  const targetDir = join(template, 'targets');
  const sourceRoot = join(base, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);
  // The old state is produced by the client itself, so modes and layout are real.
  const setup = await downloadTargets({
    metadataDir, metadataUrl: METADATA_URL, targetBaseUrl: TARGET_URL,
    targetDir: scenario.cachedBefore ? targetDir : join(base, 'discarded-targets'),
    targetNames: [TARGET_NAME], now: NOW,
    fetchImpl: targetMirror(scenario.setup, OLD_TARGET),
  });
  assert.equal(setup.downloaded[0].cached, false, `${scenario.name}: setup`);

  const oldFiles = {};
  for (const role of ROLES) oldFiles[role] = await readFile(join(metadataDir, `${role}.json`));
  return {
    base,
    template,
    oldDigests: digests(oldFiles),
    newDigests: digests({ ...scenario.next, root: oldFiles.root }),
    oldTargetDigest: scenario.oldTarget === null ? null : sha256(scenario.oldTarget),
    newTargetDigest: sha256(scenario.newTarget),
    spec: {
      now: NOW.toISOString(),
      targetName: TARGET_NAME,
      mirror: encodeBundle(scenario.next),
      targetBytes: b64(scenario.newTarget),
      newBundle: encodeBundle(scenario.next),
      newTargetBytes: b64(scenario.newTarget),
    },
  };
}

const dirsOf = (root) => ({ metadataDir: join(root, 'metadata'), targetDir: join(root, 'targets') });

async function traceDownload(ctx, { withOps = false } = {}) {
  const root = join(ctx.base, 'trace');
  await cp(ctx.template, root, { recursive: true });
  const log = join(ctx.base, 'trace.log');
  const out = join(ctx.base, 'trace.out.json');
  const opsLog = withOps ? join(ctx.base, 'trace.ops') : undefined;
  const run = await runWorker(ctx.base, {
    mode: 'download', ...ctx.spec, ...dirsOf(root), killAt: null, log, out, opsLog,
  });
  assert.equal(run.status, 0, `uninterrupted download failed\n${run.stderr}`);
  const lines = await readJsonLines(log);
  return {
    result: JSON.parse(await readFile(out, 'utf8')),
    steps: lines.filter((line) => line.step !== undefined).map((line) => line.label),
    failed: new Set(lines.filter((line) => line.failed !== undefined).map((line) => line.failed)),
    ops: withOps ? await readJsonLines(opsLog) : null,
  };
}

/** Harness-drift guard for the target write, and durability of created directories. */
function assertTargetProtocol(steps, scenario) {
  const target = steps.filter(isTargetStep);
  const rename = target.indexOf('rename .demo.bin.tmp -> demo.bin');
  assert.ok(rename >= 0, `${scenario.name}: target rename not traced`);
  const create = target.indexOf('create .demo.bin.tmp');
  assert.ok(create >= 0 && create < rename, `${scenario.name}: target create not traced`);
  const between = target.slice(create + 1, rename);
  assert.ok(between.includes('write .demo.bin.tmp'), `${scenario.name}: target write not traced`);
  assert.ok(between.includes('fsync .demo.bin.tmp'), `${scenario.name}: target renamed without fsync`);
  assert.equal(target[rename + 1], 'fsync-dir artifacts', `${scenario.name}: target rename not made durable`);
  if (!scenario.cachedBefore) {
    // mkdir created <target-dir> and artifacts: the entry `artifacts` lives in
    // <target-dir>, the entry of <target-dir> in its parent. Both need a sync.
    const mkdirAt = target.findIndex((label) => label.startsWith('mkdir'));
    assert.ok(mkdirAt >= 0 && mkdirAt < create, `${scenario.name}: directory creation not traced`);
    const syncs = steps.slice(steps.indexOf(target[mkdirAt]) + 1).filter((label) => label.startsWith('fsync-dir'));
    assert.ok(syncs.includes('fsync-dir <target-dir>'), `${scenario.name}: new entry in the target directory not synced`);
    assert.ok(syncs.includes('fsync-dir template') || syncs.some((label) => /^fsync-dir (trace|k\d+)$/.test(label)),
      `${scenario.name}: the new target directory's own entry not synced (${syncs.join(', ')})`);
  }
}

/** T1-T5 for the state under `root`, observed by a fresh process. */
async function observeAndCheck(ctx, scenario, root, tag, context) {
  const out = join(ctx.base, `${tag}.after.json`);
  const after = await runWorker(ctx.base, {
    mode: 'after-download-crash', ...ctx.spec, ...dirsOf(root), out,
  });
  assert.equal(after.status, 0, `${context}: observer process failed\n${after.stderr}`);
  const observed = JSON.parse(await readFile(out, 'utf8'));
  const { crashed } = observed;

  // Metadata keeps its own contract (K1, K2).
  for (const role of ROLES) {
    assert.ok(
      [ctx.oldDigests[role], ctx.newDigests[role]].includes(crashed.metadata.files[role]),
      `${context}: ${role}.json is neither the old nor the new file`,
    );
  }
  const metadataNew = sameFiles(crashed.metadata.files, ctx.newDigests) && crashed.metadata.marker === null;
  const metadataOld = sameFiles(crashed.metadata.files, ctx.oldDigests);
  if (metadataNew || metadataOld) {
    assert.equal(observed.offline.ok, true, `${context}: complete metadata refused offline: ${observed.offline.message}`);
  } else {
    assert.equal(observed.offline.code, 'PERSISTED_STATE_UNVERIFIED', `${context}: mixed metadata verified offline`);
  }

  // T1: no torn, empty or foreign target.
  assert.notEqual(crashed.target.kind, 'other', `${context}: output path is not a regular file`);
  const targetState = crashed.target.file === ctx.newTargetDigest ? 'new'
    : crashed.target.file === null && ctx.oldTargetDigest === null ? 'absent'
      : crashed.target.file === ctx.oldTargetDigest ? 'old'
        : 'torn';
  assert.notEqual(targetState, 'torn', `${context}: target is neither the old nor the new bytes (${crashed.target.file})`);

  // T2: the new target only under completely committed new metadata.
  if (targetState === 'new') {
    assert.ok(metadataNew, `${context}: new target on disk before its metadata was committed`);
  }

  // T3: one download converges, without re-fetching what is already correct.
  assert.equal(observed.recovery.ok, true, `${context}: recovery failed: ${observed.recovery.code} ${observed.recovery.message}`);
  assert.deepEqual(observed.recovered.metadata.files, ctx.newDigests, `${context}: metadata not recovered`);
  assert.equal(observed.recoveredOffline.ok, true, context);
  assert.equal(observed.recovered.target.file, ctx.newTargetDigest, `${context}: target not recovered`);
  assert.equal(observed.recovery.value.cached, targetState === 'new', `${context}: cache decision`);
  assert.equal(observed.recovery.value.targetRequests, targetState === 'new' ? 0 : 1, `${context}: target requests`);

  // T4: no temp anywhere.
  assert.deepEqual(observed.recovered.metadata.temps, [], `${context}: metadata temp left after recovery`);
  assert.deepEqual(observed.recovered.target.temps, [], `${context}: target temp left after recovery`);

  // T5: healed.
  assert.equal(observed.second.ok, true, context);
  assert.equal(observed.second.value.status, 'no-update', `${context}: second download refreshed`);
  assert.equal(observed.second.value.cached, true, `${context}: second download not a cache hit`);
  assert.equal(observed.second.value.targetRequests, 0, `${context}: second download fetched the target`);

  return {
    metadata: metadataNew ? 'new' : metadataOld ? 'old' : 'between',
    target: targetState,
    targetTempsAfterCrash: crashed.target.temps.length,
    metadataTempsAfterCrash: crashed.metadata.temps.length,
    recoveryCached: observed.recovery.value.cached,
    staleTargetTempsRemoved: observed.recovery.value.staleTempsRemoved?.length ?? null,
  };
}

async function killMatrix(fx, scenario) {
  const ctx = await prepare(fx, scenario, 'dlkill');
  const trace = await traceDownload(ctx);
  assert.equal(trace.result.cached, false, `${scenario.name}: uninterrupted control`);
  assert.equal(trace.result.targetRequests, 1, `${scenario.name}: uninterrupted control`);
  assertTargetProtocol(trace.steps, scenario);
  if (process.env.BROWSER_TUF_TRACE_STEPS) console.error(scenario.name, trace.steps, [...trace.failed]);
  // The refresh part keeps its own protocol guard; failed steps (the unlink of an
  // absent marker) are renumbered to the positions among the metadata steps.
  const metadataSteps = [];
  const failed = new Set();
  trace.steps.forEach((label, index) => {
    if (isTargetStep(label)) return;
    metadataSteps.push(label);
    if (trace.failed.has(index + 1)) failed.add(metadataSteps.length);
  });
  if (metadataSteps.some((label) => label.startsWith('rename'))) {
    assertProtocolSteps(metadataSteps, scenario.name, failed);
  }

  const rows = [];
  for (let killAt = 1; killAt <= trace.steps.length + 1; killAt += 1) {
    const point = pointLabel(trace.steps, killAt);
    const tag = `k${killAt}`;
    const root = join(ctx.base, tag);
    await cp(ctx.template, root, { recursive: true });
    const log = join(ctx.base, `${tag}.log`);
    const killed = await runWorker(ctx.base, {
      mode: 'download', ...ctx.spec, ...dirsOf(root),
      killAt, total: trace.steps.length, log, out: join(ctx.base, `${tag}.out.json`),
    });
    assert.equal(killed.signal, 'SIGKILL', `${tag}: not killed (status ${killed.status})\n${killed.stderr}`);
    const lines = await readJsonLines(log);
    assert.deepEqual(
      lines.filter((line) => line.step !== undefined && line.killed === undefined).map((line) => line.label)
        .map((label) => label.replace(/^fsync-dir k\d+$/, 'fsync-dir trace')),
      trace.steps.slice(0, Math.min(killAt, trace.steps.length)),
      `${tag}: the killed run must follow the traced sequence`,
    );
    const row = await observeAndCheck(
      ctx, scenario, root, tag,
      `${scenario.name} kill ${killAt}/${trace.steps.length + 1} (${point})`,
    );
    rows.push({ killAt, point, ...row });
  }
  await rm(ctx.base, { recursive: true, force: true });
  return { steps: trace.steps, rows };
}

for (const index of [0, 1]) {
  test(`process kill before every download step leaves old or new target under its own metadata (scenario ${index + 1})`, {
    skip: MATRIX_SKIP,
    timeout: 300_000,
  }, async (t) => {
    const { fx, list } = await scenarios();
    const scenario = list[index];
    const { steps, rows } = await killMatrix(fx, scenario);
    const count = (key, value) => rows.filter((row) => row[key] === value).length;
    t.diagnostic(`${scenario.name}: ${steps.length} steps, ${rows.length} kill points; `
      + `target absent ${count('target', 'absent')}, old ${count('target', 'old')}, new ${count('target', 'new')}; `
      + `kill points that left a target temp: ${rows.filter((row) => row.targetTempsAfterCrash > 0).length}`);
    await writeReport(`kill-download-${scenario.name}`, { scenario: scenario.name, steps, rows });
    // Both sides of the target write must be reached, and the sweep exercised.
    assert.ok(count('target', 'new') > 0, 'no kill point after the target rename');
    assert.ok(count('target', scenario.cachedBefore ? 'old' : 'absent') > 0, 'no kill point before the target rename');
    assert.ok(rows.some((row) => row.targetTempsAfterCrash > 0), 'no kill point left a target temp');
    for (const row of rows.filter((entry) => entry.targetTempsAfterCrash > 0)) {
      assert.equal(row.staleTargetTempsRemoved, row.targetTempsAfterCrash, `kill ${row.killAt}: sweep not reported`);
    }
  });
}

test('every power-loss state of the target directory holds the old or the new target, and a returned download is durable', {
  skip: MATRIX_SKIP,
  timeout: 300_000,
}, async (t) => {
  const { fx, list } = await scenarios();
  const scenario = list[1];
  const ctx = await prepare(fx, scenario, 'dlpower');
  const trace = await traceDownload(ctx, { withOps: true });

  // The operations inside the target's directory, named relative to it. Everything
  // before them (the refresh) is durable by K6 before the first one starts.
  const prefix = '../targets/artifacts';
  const inTargetDir = (name) => name === prefix || name?.startsWith(`${prefix}/`);
  const local = (name) => (name === prefix ? '.' : name.slice(prefix.length + 1));
  const firstTargetOp = trace.ops.findIndex((op) => inTargetDir(op.name ?? op.from));
  assert.ok(firstTargetOp > 0, 'no target operation recorded after the refresh');
  assert.ok(trace.ops.slice(firstTargetOp).every((op) => inTargetDir(op.name ?? op.from)),
    'metadata operations after the first target operation: the model below would not cover them');
  const targetOps = trace.ops.slice(firstTargetOp).map((op) => ({
    ...op,
    ...(op.name !== undefined ? { name: local(op.name) } : {}),
    ...(op.from !== undefined ? { from: local(op.from), to: local(op.to) } : {}),
  }));

  const { states, finalStates, opCount } = powerLossStates(new Map([['demo.bin', OLD_TARGET]]), targetOps);

  // T6: the download returned, so a power cut now must not lose the target.
  for (const state of finalStates) {
    assert.deepEqual(state.files.get('demo.bin'), NEW_TARGET, 'a power cut after the download returned lost the target');
  }

  // Each distinct state under the committed new metadata (what the trace left).
  const rows = [];
  for (const [index, state] of states.entries()) {
    const root = join(ctx.base, `p${index}`);
    await cp(join(ctx.base, 'trace'), root, { recursive: true });
    const artifacts = join(root, 'targets', 'artifacts');
    await rm(artifacts, { recursive: true, force: true });
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    for (const [name, content] of state.files) await writeFile(join(artifacts, name), content, { mode: 0o600 });
    const row = await observeAndCheck(
      ctx, scenario, root, `p${index}`,
      `power loss after target op ${state.prefix}/${opCount}, state: ${(await readdir(artifacts)).join(', ')}`,
    );
    rows.push({ prefix: state.prefix, files: [...state.files.keys()], ...row });
  }
  t.diagnostic(`${scenario.name}: ${opCount} target operations, ${rows.length} distinct power-loss states, `
    + `${finalStates.length} after return`);
  await writeReport('power-download', { scenario: scenario.name, opCount, rows });
  assert.ok(rows.some((row) => row.target === 'old') && rows.some((row) => row.target === 'new'));
  await rm(ctx.base, { recursive: true, force: true });
});
