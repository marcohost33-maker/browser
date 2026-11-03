// P2-BR59-01 (cross-family review 2026-10-13): the 5.3.11 reset marker is a
// local, unsigned file. These tests pin down what it can and cannot do:
//
// 1. Another account cannot plant or alter trusted state at all: the client
//    refuses a metadata directory or trusted file that is a link, owned by
//    another account, or writable by group/others (INSECURE_LOCAL_STATE).
// 2. For the running account, a forged marker grants nothing beyond what
//    deleting timestamp/snapshot/targets.json already grants: over the whole
//    differential corpus both tamperings give the same outcome, the same
//    requests and the same effective trust state. The root floor is untouched.
// 3. That shared boundary is real and stated, not hidden: both tamperings let a
//    validly signed older chain through that the untampered client refuses.
//    TUF has no defence against local control of the trusted store either
//    (specification issue #107); closing it needs an externally anchored
//    monotonic backstop, which the spike does not claim.
import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  initClient,
  loadTrustedState,
  refreshClient,
  trustedStateEntryProblem,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import { parseTufMetadataBytes } from '../../spike/tuf-offline-metadata/strict-json.js';
import {
  bundleMirror,
  chainAtVersion,
  corpusFixture,
  decode,
  METADATA_URL,
  writePrivate,
} from './client-fixtures.mjs';

const NOW = new Date('2026-09-27T19:45:00.000Z');
const POSIX = process.platform !== 'win32';
const HONEST_VERSION = 50;

const isInsecure = (error) => error?.code === 'INSECURE_LOCAL_STATE';

// Fake lstat results for the pure boundary rule.
function fakeStat({ kind = 'file', uid = 1000, mode = 0o600 } = {}) {
  return {
    uid,
    mode: (kind === 'dir' ? 0o040000 : kind === 'link' ? 0o120000 : 0o100000) | mode,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

test('the trusted-state boundary rule: owner, group/other write bit and real file type', () => {
  const posix = { uid: 1000, posix: true };
  const ok = (stat, directory = false) => trustedStateEntryProblem(stat, { directory, ...posix });

  assert.equal(ok(fakeStat()), null);
  assert.equal(ok(fakeStat({ mode: 0o644 })), null, 'read access for others is not write access');
  assert.equal(ok(fakeStat({ kind: 'dir', mode: 0o755 }), true), null);
  assert.equal(ok(fakeStat({ uid: 0 })), 'is owned by another account');
  assert.equal(ok(fakeStat({ mode: 0o620 })), 'is writable by group or others');
  assert.equal(ok(fakeStat({ mode: 0o602 })), 'is writable by group or others');
  assert.equal(ok(fakeStat({ kind: 'dir', mode: 0o775 }), true), 'is writable by group or others');
  assert.equal(ok(fakeStat({ kind: 'link', mode: 0o777 })), 'is not a regular file');
  assert.equal(ok(fakeStat({ kind: 'dir' })), 'is not a regular file');
  assert.equal(ok(fakeStat({ kind: 'link' }), true), 'is not a real directory');
  assert.equal(ok(fakeStat({ kind: 'file' }), true), 'is not a real directory');

  // Without POSIX owner/mode semantics (Windows) only the type rule applies.
  const windows = { directory: false, uid: null, posix: false };
  assert.equal(trustedStateEntryProblem(fakeStat({ uid: 0, mode: 0o666 }), windows), null);
  assert.equal(trustedStateEntryProblem(fakeStat({ kind: 'link' }), windows), 'is not a regular file');
});

async function initializedClient(fx, name) {
  const metadataDir = join(fx.dir, name);
  const sourceRoot = join(fx.dir, `${name}-source-root.json`);
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);
  return metadataDir;
}

test('the client creates private trusted state even under a group-writable umask', { skip: !POSIX }, async () => {
  const fx = await corpusFixture('browser-tuf-boundary-umask-');
  const previous = process.umask(0o002);
  let metadataDir;
  try {
    metadataDir = await initializedClient(fx, 'metadata-umask');
    await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: bundleMirror(fx),
    });
  } finally {
    process.umask(previous);
  }
  assert.equal((await lstat(metadataDir)).mode & 0o777, 0o700);
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    assert.equal((await lstat(join(metadataDir, `${role}.json`))).mode & 0o777, 0o600, role);
  }
  assert.equal((await loadTrustedState(metadataDir)).rollbackStateReset, null);
});

test('another account cannot plant or reach trusted state (INSECURE_LOCAL_STATE)', { skip: !POSIX }, async () => {
  const fx = await corpusFixture('browser-tuf-boundary-');
  const markerContent = '{"root_version":1}\n';

  async function refreshedClient(name) {
    const metadataDir = await initializedClient(fx, name);
    await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: bundleMirror(fx),
    });
    return metadataDir;
  }

  async function assertRefused(metadataDir, label) {
    await assert.rejects(loadTrustedState(metadataDir), isInsecure, `${label}: load`);
    const requests = [];
    await assert.rejects(refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: bundleMirror(fx, requests),
    }), isInsecure, `${label}: refresh`);
    assert.deepEqual(requests, [], `${label}: refused before any request`);
  }

  // A metadata directory that group members could write to.
  {
    const metadataDir = await refreshedClient('metadata-group-dir');
    await chmod(metadataDir, 0o770);
    await assertRefused(metadataDir, 'group-writable directory');
    await chmod(metadataDir, 0o700);
    await assert.doesNotReject(loadTrustedState(metadataDir), 'control: private again');
  }

  // A world-writable reset marker, and one that is only group-writable.
  for (const mode of [0o666, 0o620]) {
    const metadataDir = await refreshedClient(`metadata-marker-${mode.toString(8)}`);
    const markerPath = join(metadataDir, 'rollback-reset.json');
    await writePrivate(markerPath, markerContent);
    await chmod(markerPath, mode);
    await assertRefused(metadataDir, `marker mode ${mode.toString(8)}`);
  }

  // A trusted file replaced by a link to bytes outside the directory, even
  // when the link target is the very same file content.
  for (const role of ['root', 'timestamp', 'rollback-reset']) {
    const metadataDir = await refreshedClient(`metadata-link-${role}`);
    const outside = join(fx.dir, `outside-${role}.json`);
    const path = join(metadataDir, `${role}.json`);
    const content = role === 'rollback-reset' ? markerContent : await readFile(path);
    await writePrivate(outside, content);
    await unlink(path).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await symlink(outside, path);
    await assertRefused(metadataDir, `${role}.json as a link`);
  }

  // The metadata directory itself as a link.
  {
    const real = await refreshedClient('metadata-real');
    const linked = join(fx.dir, 'metadata-linked');
    await symlink(real, linked);
    await assertRefused(linked, 'linked metadata directory');
  }

  // init refuses to bootstrap into a directory others can write, and writes nothing.
  {
    const metadataDir = join(fx.dir, 'metadata-init-shared');
    await mkdir(metadataDir, { mode: 0o700 });
    await chmod(metadataDir, 0o777);
    const sourceRoot = join(fx.dir, 'init-source-root.json');
    await writeFile(sourceRoot, fx.root);
    await assert.rejects(initClient(metadataDir, sourceRoot), isInsecure);
    await assert.rejects(lstat(join(metadataDir, 'root.json')), (error) => error?.code === 'ENOENT');
  }
});

// Effective trust state after a refresh attempt, plus how it ended.
async function outcome(metadataDir, testCase) {
  const requests = [];
  let ended;
  try {
    const result = await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: new Date(testCase.now),
      fetchImpl: bundleMirror({
        roots: testCase.roots_b64.map(decode),
        timestamp: decode(testCase.timestamp_b64),
        snapshot: decode(testCase.snapshot_b64),
        targets: decode(testCase.targets_b64),
      }, requests),
    });
    ended = { status: result.status };
  } catch (error) {
    if (typeof error?.code !== 'string') throw error;
    ended = { error: error.code };
  }
  const state = await loadTrustedState(metadataDir);
  return {
    ...ended,
    requests,
    root: state.trustedState.root.signed.version,
    versions: state.trustedState.versions,
  };
}

test('a forged reset marker grants nothing beyond deleting the retained role files (P2-BR59-01)', async () => {
  const fx = await corpusFixture('browser-tuf-no-amplification-');
  const honest = chainAtVersion(fx, HONEST_VERSION);
  const cases = fx.corpus.cases.filter((entry) => entry.trusted_root_b64 === fx.root.toString('base64'));
  assert.ok(cases.length >= 18, `corpus shrank to ${cases.length} cases`);
  for (const entry of cases) {
    let version;
    try {
      version = parseTufMetadataBytes(decode(entry.timestamp_b64)).signed?.version;
    } catch {
      continue; // malformed on purpose (profile observations)
    }
    if (Number.isSafeInteger(version)) assert.ok(version < HONEST_VERSION, entry.name);
  }

  // Honest trusted state: floors at HONEST_VERSION, above every corpus chain.
  async function honestClient(name) {
    const metadataDir = await initializedClient(fx, name);
    await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: bundleMirror(honest),
    });
    const { versions } = (await loadTrustedState(metadataDir)).trustedState;
    assert.deepEqual(versions, {
      timestamp: HONEST_VERSION,
      snapshot: HONEST_VERSION,
      targets: HONEST_VERSION,
    });
    return metadataDir;
  }

  let compared = 0;
  const boundaryCases = [];
  for (const [index, entry] of cases.entries()) {
    const untouched = await honestClient(`untouched-${index}`);

    const forged = await honestClient(`forged-${index}`);
    await writePrivate(join(forged, 'rollback-reset.json'), '{"root_version":1}\n');

    const deleted = await honestClient(`deleted-${index}`);
    for (const role of ['timestamp', 'snapshot', 'targets']) {
      await unlink(join(deleted, `${role}.json`));
    }

    const viaMarker = await outcome(forged, entry);
    const viaDeletion = await outcome(deleted, entry);
    assert.deepEqual(viaMarker, viaDeletion, `${entry.name}: the marker must not exceed deletion`);
    assert.ok(viaMarker.root >= 1, entry.name);
    compared += 1;

    // The untampered client keeps its floors against every corpus chain, except
    // where a newer ROOT rotates the timestamp/snapshot keys: that reset is
    // authorised by the root keys (5.3.11), not by local state.
    const baseline = await outcome(untouched, entry);
    if ('status' in baseline) {
      assert.ok(baseline.root > 1, `${entry.name}: only a root rotation may lower the floors`);
      assert.deepEqual(viaMarker, baseline, `${entry.name}: same result as the root-authorised reset`);
    } else {
      assert.deepEqual(baseline.versions, {
        timestamp: HONEST_VERSION,
        snapshot: HONEST_VERSION,
        targets: HONEST_VERSION,
      }, `${entry.name}: a refused chain leaves the floors in place`);
      if ('status' in viaMarker) boundaryCases.push(entry.name);
    }
  }
  assert.equal(compared, cases.length);
  // The documented boundary: tampering by the account itself (marker or
  // deletion alike) lets the corpus' validly signed OLDER chains through that
  // the untampered floors refuse. Pinned so that a change in either direction
  // is noticed and re-reviewed.
  assert.deepEqual(boundaryCases.sort(), [
    'reject-timestamp-rollback-against-trusted-state',
    'valid-pretty-envelope',
    'valid-unicode-key-ordering',
  ]);
});
