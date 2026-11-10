// Real process kills inside a refresh (BR64-04, cross-family review of #64).
//
// The crash tests in tuf-client-cli.test.js throw from a patched rename/unlink in the
// same process: the finally blocks still run, temp files are removed, handles are
// closed, and nothing between create, write, fsync and the directory sync is ever
// interrupted. Here a separate process (process-kill-worker.mjs) is killed with
// SIGKILL before every single mutating or durability step, and after the last one.
// A fresh process then starts on what was left and checks K1-K5
// (crash-matrix-support.mjs).
//
// Three matrices:
//   single  one kill per refresh, three scenarios (plain update, root rotation with
//           the 5.3.11 reset, rotation over a fast-forwarded targets floor);
//   double  a second kill INSIDE the recovery refresh of every distinct first-kill
//           state (crash during recovery), on the rotation scenario where the reset
//           marker has to survive both; every third recovery step by default, every
//           step and all scenarios with BROWSER_TUF_CRASH_EXHAUSTIVE=1;
//   init    kills during the bootstrap (initClient), then re-init and refresh.
//
// Model limit (THREAT-MODEL.md): a SIGKILL leaves the kernel page cache intact, so
// this proves the ORDER of the protocol against a process crash. What a power cut
// may lose is covered by tuf-client-power-loss.test.js.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sha256 } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import {
  assertProtocolSteps,
  digests,
  encodeBundle,
  killRefresh,
  MATRIX_SKIP,
  NOW,
  observeAndCheck,
  prepareTemplate,
  readJsonLines,
  runWorker,
  scenarios,
  traceRefresh,
  writeReport,
} from './crash-matrix-support.mjs';

const EXHAUSTIVE = process.env.BROWSER_TUF_CRASH_EXHAUSTIVE === '1';
const TEMP_NAME = /^\.(.+)\.tmp-\d+-\d+$/;

const pointLabel = (steps, killAt) => (killAt <= steps.length
  ? `before ${steps[killAt - 1]}`
  : `after ${steps.at(-1)}`);

async function scenarioContext(fx, scenario, prefix) {
  const base = await mkdtemp(join(tmpdir(), `browser-tuf-${prefix}-${scenario.name}-`));
  const { template, oldFiles } = await prepareTemplate(fx, base, scenario);
  return {
    base,
    template,
    oldDigests: digests(oldFiles),
    newDigests: digests({ ...scenario.next, root: scenario.next.roots.at(-1) ?? oldFiles.root }),
    oldBundle: encodeBundle(scenario.setup),
    newBundle: encodeBundle(scenario.next),
  };
}

/** Identity of a crash state for deduplication: role files, marker, temp names without pid. */
async function stateKey(dir) {
  const hash = createHash('sha256');
  for (const name of (await readdir(dir)).sort()) {
    const temp = TEMP_NAME.exec(name);
    hash.update(temp ? `.${temp[1]}.tmp` : name).update('\0');
    hash.update(await readFile(join(dir, name))).update('\0');
  }
  return hash.digest('hex');
}

async function singleKillMatrix(fx, scenario) {
  const ctx = await scenarioContext(fx, scenario, 'kill');
  const trace = await traceRefresh(ctx.base, ctx.template, 'single', ctx.newBundle);
  assert.equal(trace.status, 'metadata-verified', `${scenario.name}: uninterrupted control`);
  assertProtocolSteps(trace.steps, scenario.name, trace.failed);

  const rows = [];
  for (let killAt = 1; killAt <= trace.steps.length + 1; killAt += 1) {
    const point = pointLabel(trace.steps, killAt);
    const tag = `k${killAt}`;
    const metadataDir = join(ctx.base, tag);
    await cp(ctx.template, metadataDir, { recursive: true });
    await killRefresh(ctx.base, metadataDir, tag, ctx.newBundle, killAt, trace.steps);
    const row = await observeAndCheck({
      ...ctx, metadataDir, tag,
      context: `${scenario.name} kill ${killAt}/${trace.steps.length + 1} (${point})`,
    });
    rows.push({ killAt, point, ...row });
  }
  await rm(ctx.base, { recursive: true, force: true });
  return { steps: trace.steps, rows };
}

for (const index of [0, 1, 2]) {
  test(`process kill before every refresh step leaves old, new or refused state (BR64-04, scenario ${index + 1})`, {
    skip: MATRIX_SKIP,
    timeout: 300_000,
  }, async (t) => {
    const { fx, list } = await scenarios();
    const scenario = list[index];
    const { steps, rows } = await singleKillMatrix(fx, scenario);
    const count = (value) => rows.filter((row) => row.state === value).length;
    t.diagnostic(`${scenario.name}: ${steps.length} steps, ${rows.length} kill points, `
      + `old ${count('old')}, between ${count('between')}, new ${count('new')}`);
    await writeReport(`kill-single-${scenario.name}`, { scenario: scenario.name, steps, rows });
    // Every class must be reached, or the matrix did not exercise the contract.
    assert.ok(count('old') > 0 && count('between') > 0 && count('new') > 0);
  });
}

async function doubleKillMatrix(fx, scenario, stride) {
  const ctx = await scenarioContext(fx, scenario, 'kill2');
  const first = await traceRefresh(ctx.base, ctx.template, 'first', ctx.newBundle);
  const seen = new Set();
  const rows = [];
  for (let firstKill = 1; firstKill <= first.steps.length; firstKill += 1) {
    const crashed = join(ctx.base, `f${firstKill}`);
    await cp(ctx.template, crashed, { recursive: true });
    await killRefresh(ctx.base, crashed, `f${firstKill}`, ctx.newBundle, firstKill, first.steps);
    const key = await stateKey(crashed);
    if (seen.has(key)) continue; // same state, same recovery: already covered
    seen.add(key);

    // The recovery from this state, uninterrupted: its own step sequence.
    const recovery = await traceRefresh(ctx.base, crashed, `r${firstKill}`, ctx.newBundle);
    if (recovery.steps.length === 0) {
      // Nothing to interrupt: the state is already complete; the single matrix
      // observed it at this kill point.
      rows.push({ firstKill, secondKill: null, state: 'no-recovery-steps' });
      continue;
    }
    for (let secondKill = 1; secondKill <= recovery.steps.length + 1; secondKill += 1) {
      if (!EXHAUSTIVE && secondKill % stride !== 1 && secondKill !== recovery.steps.length + 1) continue;
      const tag = `f${firstKill}-s${secondKill}`;
      const metadataDir = join(ctx.base, tag);
      await cp(crashed, metadataDir, { recursive: true });
      await killRefresh(ctx.base, metadataDir, tag, ctx.newBundle, secondKill, recovery.steps);
      const row = await observeAndCheck({
        ...ctx, metadataDir, tag,
        context: `${scenario.name} first kill ${firstKill} (${pointLabel(first.steps, firstKill)}), `
          + `recovery kill ${secondKill} (${pointLabel(recovery.steps, secondKill)})`,
      });
      rows.push({ firstKill, secondKill, ...row });
    }
  }
  await rm(ctx.base, { recursive: true, force: true });
  return { firstStates: seen.size, rows };
}

test('a second kill during the recovery still leaves old, new or refused state (double crash)', {
  // No mutant names this matrix as its detector (the single and power-loss matrices
  // catch every crash mutant), so the mutation study never runs it: ~35 s saved per
  // mutant. The suite itself always runs it.
  skip: MATRIX_SKIP || (process.env.BROWSER_TUF_MUTATION_STUDY === '1'
    && 'double-kill matrix is not a detector of any mutant'),
  timeout: 1_800_000,
}, async (t) => {
  const { fx, list } = await scenarios();
  const selected = EXHAUSTIVE ? list : [list[1]];
  for (const scenario of selected) {
    const { firstStates, rows } = await doubleKillMatrix(fx, scenario, 3);
    const kills = rows.filter((row) => row.secondKill !== null);
    t.diagnostic(`${scenario.name}: ${firstStates} distinct first-kill states, ${kills.length} recovery kills`
      + `${EXHAUSTIVE ? ' (exhaustive)' : ' (every third recovery step and the last)'}`);
    await writeReport(`kill-double-${scenario.name}`, { scenario: scenario.name, exhaustive: EXHAUSTIVE, firstStates, rows });
    assert.ok(firstStates >= 5, `${scenario.name}: too few distinct first-kill states`);
    assert.ok(rows.some((row) => row.state === 'between'), 'no recovery kill left a state in between');
  }
});

test('a kill during the bootstrap leaves no root or the exact root, and init or refresh completes it', {
  skip: MATRIX_SKIP,
  timeout: 300_000,
}, async (t) => {
  const { fx, list } = await scenarios();
  const base = await mkdtemp(join(tmpdir(), 'browser-tuf-kill-init-'));
  const sourceRoot = join(base, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  const newBundle = encodeBundle(list[0].setup);
  const rootDigest = sha256(fx.root);

  const traceLog = join(base, 'init-trace.log');
  const trace = await runWorker(base, {
    mode: 'init', metadataDir: join(base, 'trace', 'metadata'), sourceRoot,
    now: NOW.toISOString(), killAt: null, log: traceLog, out: join(base, 'init-trace.out.json'),
  });
  assert.equal(trace.status, 0, trace.stderr);
  const traceLines = await readJsonLines(traceLog);
  const steps = traceLines.filter((line) => line.step !== undefined).map((line) => line.label);
  assertProtocolSteps(steps, 'init', new Set(traceLines.filter((line) => line.failed).map((line) => line.failed)));
  assert.ok(steps.some((label) => label.startsWith('mkdir')), 'the directory is created by the bootstrap');

  const rows = [];
  for (let killAt = 1; killAt <= steps.length + 1; killAt += 1) {
    const context = `init kill ${killAt} (${pointLabel(steps, killAt)})`;
    const metadataDir = join(base, `i${killAt}`, 'metadata');
    const log = join(base, `i${killAt}.log`);
    const killed = await runWorker(base, {
      mode: 'init', metadataDir, sourceRoot, now: NOW.toISOString(),
      killAt, total: steps.length, log, out: join(base, `i${killAt}.out.json`),
    });
    assert.equal(killed.signal, 'SIGKILL', `${context}: not killed\n${killed.stderr}`);

    const out = join(base, `i${killAt}.after.json`);
    const after = await runWorker(base, {
      mode: 'after-init-crash', metadataDir, sourceRoot, now: NOW.toISOString(), newBundle, out,
    });
    assert.equal(after.status, 0, `${context}: observer failed\n${after.stderr}`);
    const observed = JSON.parse(await readFile(out, 'utf8'));
    const rootThere = observed.crashed?.files.root ?? null;
    // No torn root: absent, or exactly the bootstrap root.
    assert.ok(rootThere === null || rootThere === rootDigest, `${context}: root.json torn or foreign`);
    if (rootThere === null) {
      assert.equal(observed.reinit.ok, true, `${context}: re-init refused: ${observed.reinit.code}`);
    } else {
      assert.equal(observed.reinit.code, 'METADATA_DIR_INITIALIZED', `${context}: a complete root must not be replaced`);
    }
    assert.equal(observed.refresh.ok, true, `${context}: refresh after bootstrap failed: ${observed.refresh.code}`);
    assert.equal(observed.refresh.value.status, 'metadata-verified', context);
    assert.equal(observed.offline.ok, true, context);
    assert.equal(observed.recovered.temps.length, 0, `${context}: temp left after the first refresh`);
    rows.push({
      killAt,
      point: pointLabel(steps, killAt),
      rootAfterKill: rootThere !== null,
      tempsAfterKill: observed.crashed?.temps.length ?? 0,
      reinit: observed.reinit.ok ? 'initialised' : observed.reinit.code,
      staleTempsRemoved: observed.refresh.value.staleTempsRemoved.length,
    });
  }
  t.diagnostic(`init: ${steps.length} steps, ${rows.length} kill points, `
    + `root present after ${rows.filter((row) => row.rootAfterKill).length}`);
  await writeReport('kill-init', { steps, rows });
  assert.ok(rows.some((row) => row.rootAfterKill) && rows.some((row) => !row.rootAfterKill));
  await rm(base, { recursive: true, force: true });
});
