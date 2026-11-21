// Shared scenarios, worker driver and contract checks for the crash matrices of the
// TUF client: process kills (tuf-client-process-kill.test.js) and power-loss states
// (tuf-client-power-loss.test.js). Not a test file.
//
// Contract per crash state (cross-family review of #64, BR64-04: "old or new
// complete state, otherwise refusal"), checked by a FRESH process that first
// observes the directory exactly as the crash left it:
//   K1 every role file is byte-equal to its old or its new version;
//   K2 the offline start check verifies exactly the old or the new complete chain
//      and refuses everything in between with PERSISTED_STATE_UNVERIFIED; an
//      untouched old state stays usable offline;
//   K3 replaying the old bundle never verifies, and fails once anything new was
//      committed;
//   K4 one refresh with the new bundle reaches exactly the new state, verified
//      offline and without reset marker; a second refresh is a no-update;
//   K5 no temp file survives that refresh.
// Power loss adds
//   K6 once the refresh returned, every power-loss state is the new state.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
export const NOW = new Date('2026-09-27T19:45:00.000Z');
export const ROLES = Object.freeze(['root', 'timestamp', 'snapshot', 'targets']);
export const POSIX = process.platform !== 'win32';

// The matrices take seconds each. Inside the mutation study they run only for the
// mutants that name them (BROWSER_TUF_KILL_MATRIX, see mutation-study.mjs).
export const MATRIX_SKIP = (!POSIX && 'SIGKILL to oneself is POSIX; Windows has no signal-level kill of this shape')
  || (process.env.BROWSER_TUF_MUTATION_STUDY === '1'
    && process.env.BROWSER_TUF_KILL_MATRIX !== '1'
    && 'crash matrices run in the mutation study only for their own mutants');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
export const encodeBundle = ({ roots = [], timestamp, snapshot, targets }) => ({
  roots: roots.map(b64),
  timestamp: b64(timestamp),
  snapshot: b64(snapshot),
  targets: b64(targets),
});
export const digests = (files) => Object.fromEntries(ROLES.map((role) => [role, sha256(files[role])]));
export const sameFiles = (a, b) => ROLES.every((role) => a[role] === b[role]);

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

export async function scenarios() {
  const fx = await corpusFixture('browser-tuf-crash-');
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
        // C1 as a real crash: v2 -> v3, no root change.
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

export async function runWorker(dir, spec) {
  const specPath = join(dir, `spec-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(specPath, JSON.stringify(spec));
  return spawnSync(process.execPath, [WORKER, specPath], { encoding: 'utf8', timeout: 60_000 });
}

export async function readJsonLines(path) {
  const text = await readFile(path, 'utf8');
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** Trusted state after the scenario's setup refresh: the "old" state. */
export async function prepareTemplate(fx, base, scenario) {
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
  const names = (await readdir(template)).sort();
  return { template, oldFiles: files, oldNames: names };
}

/**
 * Harness-drift guard: every role-file replacement in the trace must be the full
 * protocol create -> write -> fsync -> rename -> fsync-dir, and every marker removal
 * must be followed by fsync-dir. If an instrumentation hook stopped seeing a step
 * kind (say the directory sync moved to another flag), the matrices would silently
 * stop crashing there; this fails instead.
 */
export function assertProtocolSteps(labels, context, failed = new Set()) {
  const kinds = new Set(labels.map((label) => label.split(' ')[0]));
  for (const kind of ['create', 'write', 'fsync', 'rename', 'fsync-dir']) {
    assert.ok(kinds.has(kind), `${context}: no '${kind}' step traced`);
  }
  labels.forEach((label, index) => {
    const rename = /^rename (\.[^ ]+\.tmp) -> (.+)$/.exec(label);
    if (rename) {
      const [, temp, target] = rename;
      const created = labels.lastIndexOf(`create ${temp}`, index);
      assert.ok(created >= 0, `${context}: ${target} renamed without a traced create`);
      const between = labels.slice(created + 1, index);
      assert.ok(between.includes(`write ${temp}`), `${context}: ${target} renamed without a traced write`);
      assert.ok(between.includes(`fsync ${temp}`), `${context}: ${target} renamed without a traced fsync`);
      assert.equal(labels[index + 1], 'fsync-dir <metadata-dir>', `${context}: ${target} rename not followed by fsync-dir`);
    }
    if (label === 'unlink rollback-reset.json' && !failed.has(index + 1)) {
      assert.equal(labels[index + 1], 'fsync-dir <metadata-dir>', `${context}: marker removal not followed by fsync-dir`);
    }
  });
}

/** Uninterrupted refresh in a worker: the step labels (and, on request, exact ops). */
export async function traceRefresh(base, sourceDir, name, bundle, { withOps = false } = {}) {
  const metadataDir = join(base, `${name}-trace`);
  await cp(sourceDir, metadataDir, { recursive: true });
  const log = join(base, `${name}-trace.log`);
  const out = join(base, `${name}-trace.out.json`);
  const opsLog = withOps ? join(base, `${name}-trace.ops`) : undefined;
  const run = await runWorker(base, {
    mode: 'refresh', metadataDir, now: NOW.toISOString(), mirror: bundle,
    killAt: null, log, out, opsLog,
  });
  assert.equal(run.status, 0, `${name}: uninterrupted run failed\n${run.stderr}`);
  const result = JSON.parse(await readFile(out, 'utf8'));
  // A refresh that changes nothing (a no-update) has no step and leaves no log.
  const lines = await readJsonLines(log).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const steps = lines.filter((line) => line.step !== undefined).map((line) => line.label);
  const failed = new Set(lines.filter((line) => line.failed !== undefined).map((line) => line.failed));
  const ops = withOps
    ? await readJsonLines(opsLog).catch((error) => (error?.code === 'ENOENT' ? [] : Promise.reject(error)))
    : null;
  return { status: result.status, steps, failed, ops };
}

/** Kill a refresh of `metadataDir` before step `killAt` (or after the last). */
export async function killRefresh(base, metadataDir, tag, bundle, killAt, steps) {
  const log = join(base, `${tag}.log`);
  const killed = await runWorker(base, {
    mode: 'refresh', metadataDir, now: NOW.toISOString(), mirror: bundle,
    killAt, total: steps.length, log, out: join(base, `${tag}.out.json`),
  });
  assert.equal(killed.signal, 'SIGKILL', `${tag}: not killed (status ${killed.status})\n${killed.stderr}`);
  const lines = await readJsonLines(log);
  assert.equal(lines.at(-1).killed, killAt <= steps.length ? 'before' : 'after', tag);
  assert.deepEqual(
    lines.filter((line) => line.step !== undefined && line.killed === undefined).map((line) => line.label),
    steps.slice(0, Math.min(killAt, steps.length)),
    `${tag}: the killed run must follow the traced sequence`,
  );
}

/** Lay a power-loss state down as a private directory, the way the client creates one. */
export async function materialize(dir, files) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  for (const [name, content] of files) {
    await writeFile(join(dir, name), content, { mode: 0o600 });
  }
}

/**
 * K1-K5 for the state in `metadataDir`, observed by a fresh process. Returns a
 * report row; throws an assertion error naming `context` on any violation.
 */
export async function observeAndCheck({
  base, metadataDir, tag, context, oldDigests, newDigests, oldBundle, newBundle,
}) {
  const out = join(base, `${tag}.after.json`);
  const after = await runWorker(base, {
    mode: 'after-crash', metadataDir, replayDir: join(base, `${tag}-replay`),
    now: NOW.toISOString(), oldBundle, newBundle, out,
  });
  assert.equal(after.status, 0, `${context}: observer process failed\n${after.stderr}`);
  const observed = JSON.parse(await readFile(out, 'utf8'));
  const { crashed } = observed;

  // K1: no torn, empty or foreign file.
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

  // K5: whatever the crash left, recovery leaves no temp behind.
  assert.equal(observed.recovered.temps.length, 0, `${context}: temp left after recovery`);

  return {
    state,
    markerAfterCrash: crashed.marker !== null,
    offline: observed.offline.ok ? 'verified' : observed.offline.code,
    replay: observed.replay.ok ? observed.replay.value : observed.replay.code,
    recovery: observed.recovery.value,
    tempsAfterCrash: crashed.temps.length,
  };
}

export async function writeReport(name, report) {
  if (!process.env.BROWSER_TUF_KILL_REPORT) return;
  await writeFile(
    join(process.env.BROWSER_TUF_KILL_REPORT, `${name}.json`),
    `${JSON.stringify({ platform: process.platform, node: process.version, ...report }, null, 2)}\n`,
  );
}
