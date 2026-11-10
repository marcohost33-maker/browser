// Real process kills inside a refresh (BR64-04, cross-family review of #64).
//
// The crash tests in tuf-client-cli.test.js throw from a patched rename/unlink in the
// same process: the finally blocks still run, temp files are removed, handles are
// closed, and nothing between create, write, fsync and the directory sync is ever
// interrupted. Here a separate process (process-kill-worker.mjs) is killed with
// SIGKILL before every single mutating or durability step of the refresh, and after
// the last one. A fresh process then starts on what was left.
//
// Contract per kill point (review BR64-04: "old or new complete state, otherwise
// refusal"):
//   K1 every role file on disk is byte-equal to its old or its new version: no torn,
//      empty or foreign file;
//   K2 the offline start check verifies exactly the old or exactly the new complete
//      chain, and refuses everything in between (PERSISTED_STATE_UNVERIFIED);
//      an untouched old state stays usable offline;
//   K3 replaying the old bundle never succeeds once anything new was committed, and
//      never writes new trust (no floor goes back through a crash);
//   K4 one refresh with the new bundle reaches exactly the new state, with no reset
//      marker, verified offline; a second refresh is a no-update (healed);
//   K5 temp files the killed process left are counted; they must never be mistaken
//      for state and must be swept by recovery.
//
// Model limit, stated in the threat model: a SIGKILL leaves the kernel page cache
// intact. This proves the ORDER of the protocol against a process crash. It cannot
// show a missing fsync; that needs power-loss emulation (see THREAT-MODEL.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { initClient, refreshClient } from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import { parseTufMetadataBytes } from '../../spike/tuf-offline-metadata/strict-json.js';
import { sha256 } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import {
  bundleMirror,
  chainAtVersion,
  corpusFixture,
  decode,
  fileDescriptor,
  METADATA_URL,
  resignedRaw,
} from './client-fixtures.mjs';

const WORKER = fileURLToPath(new URL('./process-kill-worker.mjs', import.meta.url));
const NOW = new Date('2026-09-27T19:45:00.000Z');
const ROLES = Object.freeze(['root', 'timestamp', 'snapshot', 'targets']);
const POSIX = process.platform !== 'win32';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const encodeBundle = ({ roots = [], timestamp, snapshot, targets }) => ({
  roots: roots.map(b64),
  timestamp: b64(timestamp),
  snapshot: b64(snapshot),
  targets: b64(targets),
});
const digests = (files) => Object.fromEntries(ROLES.map((role) => [role, sha256(files[role])]));
const sameFiles = (a, b) => ROLES.every((role) => a[role] === b[role]);

/** Old-key chain with the timestamp (and optionally targets) fast-forwarded. */
function fastForwardedChain(fx, { timestampVersion, targetsVersion = null }) {
  let { snapshot, targets } = fx;
  if (targetsVersion !== null) {
    const parsedTargets = parseTufMetadataBytes(fx.targets);
    parsedTargets.signed.version = targetsVersion;
    targets = resignedRaw(parsedTargets, 'targetsA');
    const parsedSnapshot = parseTufMetadataBytes(fx.snapshot);
    parsedSnapshot.signed.meta['targets.json'] = fileDescriptor(targets, targetsVersion);
    snapshot = resignedRaw(parsedSnapshot, 'snapshotA');
  }
  const parsedTimestamp = parseTufMetadataBytes(fx.timestamp);
  parsedTimestamp.signed.version = timestampVersion;
  const snapshotVersion = parseTufMetadataBytes(snapshot).signed.version;
  parsedTimestamp.signed.meta['snapshot.json'] = fileDescriptor(snapshot, snapshotVersion);
  return { roots: [], timestamp: resignedRaw(parsedTimestamp, 'timestampA'), snapshot, targets };
}

async function scenarios() {
  const fx = await corpusFixture('browser-tuf-kill-');
  const rotation = fx.corpus.cases.find(
    (entry) => entry.name === 'accept-root-rotation-old-and-new-threshold',
  );
  assert.ok(rotation, 'rotation fixture missing');
  const rotated = {
    roots: rotation.roots_b64.map(decode),
    timestamp: decode(rotation.timestamp_b64),
    snapshot: decode(rotation.snapshot_b64),
    targets: decode(rotation.targets_b64),
  };
  const corpusChain = {
    roots: [], timestamp: fx.timestamp, snapshot: fx.snapshot, targets: fx.targets,
  };
  return {
    fx,
    list: [
      {
        // C1 as a real kill: v2 -> v3, no root change.
        name: 'update-v2-v3',
        setup: corpusChain,
        next: { roots: [], ...chainAtVersion(fx, 3) },
      },
      {
        // C2: old-key timestamp fast-forwarded to 1000; the rotation resets it.
        name: 'rotation-reset-timestamp-floor',
        setup: fastForwardedChain(fx, { timestampVersion: 1000 }),
        next: rotated,
      },
      {
        // C3 (#57): additionally a fast-forwarded targets floor at 99999.
        name: 'rotation-reset-targets-floor',
        setup: fastForwardedChain(fx, { timestampVersion: 1000, targetsVersion: 99999 }),
        next: rotated,
      },
    ],
  };
}

function runWorker(dir, spec) {
  const specPath = join(dir, `spec-${Math.random().toString(16).slice(2)}.json`);
  return writeFile(specPath, JSON.stringify(spec)).then(() => spawnSync(
    process.execPath,
    [WORKER, specPath],
    { encoding: 'utf8', timeout: 60_000 },
  ));
}

async function readJsonLines(path) {
  const text = await readFile(path, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function prepareTemplate(fx, base, scenario) {
  const template = join(base, 'template');
  const sourceRoot = join(base, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(template, sourceRoot);
  const setup = await refreshClient({
    metadataDir: template,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: bundleMirror(scenario.setup),
  });
  assert.equal(setup.status, 'metadata-verified', `${scenario.name}: setup`);
  const files = {};
  for (const role of ROLES) files[role] = await readFile(join(template, `${role}.json`));
  return { template, oldFiles: files };
}

async function killMatrix(fx, scenario) {
  const base = await mkdtemp(join(tmpdir(), `browser-tuf-kill-${scenario.name}-`));
  const { template, oldFiles } = await prepareTemplate(fx, base, scenario);
  const oldDigests = digests(oldFiles);
  const newDigests = digests({ ...scenario.next, root: scenario.next.roots.at(-1) ?? oldFiles.root });
  const oldBundle = encodeBundle(scenario.setup);
  const newBundle = encodeBundle(scenario.next);

  // Uninterrupted trace: the step sequence, and the control that it ends verified.
  const traceDir = join(base, 'trace');
  await cp(template, traceDir, { recursive: true });
  const traceLog = join(base, 'trace.log');
  const traceOut = join(base, 'trace.out.json');
  const trace = await runWorker(base, {
    mode: 'refresh', metadataDir: traceDir, now: NOW.toISOString(),
    mirror: newBundle, killAt: null, log: traceLog, out: traceOut,
  });
  assert.equal(trace.status, 0, `${scenario.name}: uninterrupted run failed\n${trace.stderr}`);
  assert.equal(JSON.parse(await readFile(traceOut, 'utf8')).status, 'metadata-verified');
  const steps = await readJsonLines(traceLog);
  const total = steps.length;
  assert.ok(total >= 15, `${scenario.name}: only ${total} steps traced`);

  const rows = [];
  for (let killAt = 1; killAt <= total + 1; killAt += 1) {
    const point = killAt <= total
      ? `before ${steps[killAt - 1].label}`
      : `after ${steps[total - 1].label}`;
    const context = `${scenario.name} kill ${killAt}/${total + 1} (${point})`;
    const metadataDir = join(base, `k${killAt}`);
    await cp(template, metadataDir, { recursive: true });
    const log = join(base, `k${killAt}.log`);

    const killed = await runWorker(base, {
      mode: 'refresh', metadataDir, now: NOW.toISOString(), mirror: newBundle,
      killAt, total, log, out: join(base, `k${killAt}.out.json`),
    });
    assert.equal(killed.signal, 'SIGKILL', `${context}: not killed (status ${killed.status})\n${killed.stderr}`);
    const lines = await readJsonLines(log);
    const marker = lines.at(-1);
    assert.equal(marker.killed, killAt <= total ? 'before' : 'after', context);
    assert.deepEqual(
      lines.filter((line) => line.label !== undefined && line.killed === undefined).map((line) => line.label),
      steps.slice(0, Math.min(killAt, total)).map((step) => step.label),
      `${context}: the killed run must follow the traced sequence`,
    );

    const afterOut = join(base, `k${killAt}.after.json`);
    const after = await runWorker(base, {
      mode: 'after-crash', metadataDir, replayDir: join(base, `k${killAt}-replay`),
      now: NOW.toISOString(), oldBundle, newBundle, out: afterOut,
    });
    assert.equal(after.status, 0, `${context}: observer process failed\n${after.stderr}`);
    const observed = JSON.parse(await readFile(afterOut, 'utf8'));
    const { crashed } = observed;

    // K1: no torn file.
    for (const role of ROLES) {
      assert.ok(
        [oldDigests[role], newDigests[role]].includes(crashed.files[role]),
        `${context}: ${role}.json is neither the old nor the new file`,
      );
    }
    const isOld = sameFiles(crashed.files, oldDigests);
    const isNew = sameFiles(crashed.files, newDigests) && crashed.marker === null;
    const state = isOld ? 'old' : isNew ? 'new' : 'between';

    // K2: offline start verifies old or new, and nothing in between.
    if (state === 'between') {
      assert.equal(observed.offline.ok, false, `${context}: a mixed state verified offline`);
      assert.equal(observed.offline.code, 'PERSISTED_STATE_UNVERIFIED', `${context}: ${observed.offline.code} ${observed.offline.message}`);
      // The diagnosis, not only the code: complete new files under a pending reset
      // marker are refused BECAUSE of the reset, before any chain check runs.
      if (sameFiles(crashed.files, newDigests) && crashed.marker !== null) {
        assert.ok(observed.offline.details?.rollbackStateReset, `${context}: reset not named`);
      }
    } else {
      assert.equal(observed.offline.ok, true, `${context}: ${state} state refused offline: ${observed.offline.message}`);
      assert.deepEqual(observed.offline.value, state === 'old' ? oldDigests : newDigests, context);
    }

    // K3: the old bundle never wins once anything new is down.
    const committed = !isOld || crashed.marker !== null;
    if (isOld && crashed.marker === null) {
      assert.equal(observed.replay.ok, true, `${context}: ${observed.replay.message}`);
      assert.equal(observed.replay.value, 'no-update', context);
    } else {
      assert.notEqual(
        observed.replay.ok && observed.replay.value === 'metadata-verified',
        true,
        `${context}: replaying the old bundle verified after a crash`,
      );
      if (!isOld) assert.equal(observed.replay.ok, false, `${context}: replay accepted over committed progress`);
    }

    // K4: recovery reaches exactly the new state; then it is healed.
    assert.equal(observed.recovery.ok, true, `${context}: recovery failed: ${observed.recovery.code} ${observed.recovery.message}`);
    assert.ok(['metadata-verified', 'no-update'].includes(observed.recovery.value), context);
    assert.deepEqual(observed.recovered.files, newDigests, `${context}: recovery did not reach the new state`);
    assert.equal(observed.recovered.marker, null, `${context}: reset marker left after recovery`);
    assert.equal(observed.recoveredOffline.ok, true, context);
    assert.deepEqual(observed.recoveredOffline.value, newDigests, context);
    assert.equal(observed.second.ok, true, context);
    assert.equal(observed.second.value, 'no-update', `${context}: second refresh not quiet`);

    rows.push({
      killAt,
      point,
      state,
      markerAfterKill: crashed.marker !== null,
      committed,
      offline: observed.offline.ok ? 'verified' : observed.offline.code,
      replay: observed.replay.ok ? observed.replay.value : observed.replay.code,
      recovery: observed.recovery.value,
      tempsAfterKill: crashed.temps.length,
      tempsAfterRecovery: observed.recovered.temps.length,
    });
  }
  await rm(base, { recursive: true, force: true });
  return { steps: steps.map((step) => step.label), rows };
}

for (const index of [0, 1, 2]) {
  test(`process kill before every refresh step leaves old, new or refused state (BR64-04, scenario ${index + 1})`, {
    skip: (!POSIX && 'SIGKILL to oneself is POSIX; Windows has no signal-level kill of this shape')
      // ~17 s per suite run: inside the mutation study only for the mutants that
      // name this matrix as their detector (BROWSER_TUF_KILL_MATRIX, see
      // mutation-study.mjs), so the study stays inside its CI time budget.
      || (process.env.BROWSER_TUF_MUTATION_STUDY === '1'
        && process.env.BROWSER_TUF_KILL_MATRIX !== '1'
        && 'kill matrix runs in the mutation study only for its own mutants'),
    timeout: 300_000,
  }, async (t) => {
    const { fx, list } = await scenarios();
    const scenario = list[index];
    const { steps, rows } = await killMatrix(fx, scenario);
    const count = (field, value) => rows.filter((row) => row[field] === value).length;
    t.diagnostic(`${scenario.name}: ${steps.length} steps, ${rows.length} kill points, `
      + `old ${count('state', 'old')}, between ${count('state', 'between')}, new ${count('state', 'new')}`);
    if (process.env.BROWSER_TUF_KILL_REPORT) {
      await writeFile(
        join(process.env.BROWSER_TUF_KILL_REPORT, `${scenario.name}.json`),
        `${JSON.stringify({ scenario: scenario.name, platform: process.platform, node: process.version, steps, rows }, null, 2)}\n`,
      );
    }
    // Every class must be reached, or the matrix did not exercise the contract.
    assert.ok(count('state', 'old') > 0 && count('state', 'between') > 0 && count('state', 'new') > 0);
    // K5: whatever the kill left, recovery leaves no temp behind.
    for (const row of rows) {
      assert.equal(row.tempsAfterRecovery, 0, `${scenario.name} kill ${row.killAt} (${row.point}): temp left after recovery`);
    }
  });
}
