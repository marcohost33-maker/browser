// P2-BR59-01 (cross-family review 2026-10-13): the 5.3.11 reset marker is a
// local, unsigned file. These tests pin down what it can and cannot do:
//
// 1. Another account cannot plant or alter trusted state at all: the client
//    refuses a metadata directory or trusted file that is a link, owned by
//    another account, or writable by group/others, and any directory above it
//    that another account can rename entries in (SEI CERT FIO15-C "secure
//    directory"); after the check all IO uses the canonical path
//    (INSECURE_LOCAL_STATE).
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
  chown,
  lstat,
  mkdir,
  readFile,
  realpath,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  ancestorDirectoryProblem,
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

test('the ancestor rule: owner account or superuser, no foreign rename without the sticky bit', () => {
  const posix = { uid: 1000, posix: true };
  const dir = (mode, uid = 1000) => ancestorDirectoryProblem(fakeStat({ kind: 'dir', mode, uid }), posix);

  assert.equal(dir(0o755), null);
  assert.equal(dir(0o755, 0), null, 'the superuser may own an ancestor');
  assert.equal(dir(0o700), null);
  assert.equal(dir(0o755, 4242), 'is owned by another account');
  assert.equal(dir(0o775), 'is writable by group or others without the sticky bit');
  assert.equal(dir(0o757, 0), 'is writable by group or others without the sticky bit');
  assert.equal(dir(0o777, 0), 'is writable by group or others without the sticky bit');
  assert.equal(dir(0o1777, 0), null, 'a sticky /tmp only lets owners rename their entries');
  assert.equal(dir(0o1775), null);
  assert.equal(dir(0o1777, 4242), 'is owned by another account', 'sticky does not excuse a foreign owner');
  assert.equal(ancestorDirectoryProblem(fakeStat({ kind: 'file' }), posix), 'is not a directory');
  assert.equal(ancestorDirectoryProblem(fakeStat({ kind: 'link' }), posix), 'is not a directory');

  const windows = { uid: null, posix: false };
  assert.equal(ancestorDirectoryProblem(fakeStat({ kind: 'dir', mode: 0o777, uid: 4242 }), windows), null);
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

test('a directory above the trusted state that others can rename in is refused; IO uses the canonical path', { skip: !POSIX }, async () => {
  const fx = await corpusFixture('browser-tuf-boundary-ancestor-');

  async function refused(metadataDir, label) {
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

  // A shared parent: group members could rename metadata/ away and put their
  // own directory in its place between check and use.
  for (const mode of [0o770, 0o777, 0o707]) {
    const shared = join(fx.dir, `shared-${mode.toString(8)}`);
    await mkdir(shared, { mode: 0o700 });
    const metadataDir = await initializedClient({ ...fx, dir: shared }, 'metadata');
    await chmod(shared, mode);
    await refused(metadataDir, `parent mode ${mode.toString(8)}`);
    // The same parent with the sticky bit, as on /tmp: accepted.
    await chmod(shared, mode | 0o1000);
    await assert.doesNotReject(loadTrustedState(metadataDir), `parent mode ${(mode | 0o1000).toString(8)}`);
  }

  // Further up the chain counts as well, and init refuses to create the trusted
  // state (or any missing directory) below an insecure ancestor.
  {
    const shared = join(fx.dir, 'shared-grandparent');
    await mkdir(shared, { mode: 0o700 });
    await chmod(shared, 0o777);
    const metadataDir = join(shared, 'a', 'b', 'metadata');
    const sourceRoot = join(fx.dir, 'grandparent-source-root.json');
    await writeFile(sourceRoot, fx.root);
    await assert.rejects(initClient(metadataDir, sourceRoot), isInsecure);
    await assert.rejects(lstat(join(shared, 'a')), (error) => error?.code === 'ENOENT');

    await chmod(shared, 0o700);
    await initClient(metadataDir, sourceRoot);
    await chmod(shared, 0o777);
    await refused(metadataDir, 'grandparent mode 777');
  }

  // A link among the ancestors is resolved once, checked, and then every read
  // and write goes through the canonical directory.
  {
    const real = join(fx.dir, 'real-parent');
    await mkdir(real, { mode: 0o700 });
    const linked = join(fx.dir, 'linked-parent');
    await symlink(real, linked);
    const metadataDir = join(linked, 'metadata');
    const sourceRoot = join(fx.dir, 'linked-source-root.json');
    await writeFile(sourceRoot, fx.root);
    const init = await initClient(metadataDir, sourceRoot);
    const canonical = join(await realpath(real), 'metadata');
    assert.equal(init.path, join(canonical, 'root.json'));

    const result = await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: bundleMirror(fx),
    });
    assert.equal(result.status, 'metadata-verified');
    assert.ok(result.writes.length > 0);
    for (const write of result.writes) {
      assert.ok(write.path.startsWith(`${canonical}/`), `write outside the canonical directory: ${write.path}`);
    }
    assert.equal((await loadTrustedState(metadataDir)).metadataDir, canonical);
  }
});

// Creating a file that belongs to ANOTHER account needs the superuser. Hosted CI
// runs unprivileged, so there this end-to-end case is skipped visibly and the
// owner rule rests on the decision-function tests above.
const AS_ROOT = POSIX && typeof process.geteuid === 'function' && process.geteuid() === 0;
const OTHER_UID = 65534; // conventionally "nobody"

test('trusted state or an ancestor owned by another account is refused end to end', {
  skip: !AS_ROOT && 'needs the superuser to create files owned by another account',
}, async () => {
  const fx = await corpusFixture('browser-tuf-boundary-owner-');
  for (const target of ['metadata directory', 'timestamp.json', 'rollback-reset.json', 'ancestor']) {
    const parent = join(fx.dir, `owner-${target.replace(/\W+/g, '-')}`);
    await mkdir(parent, { mode: 0o700 });
    const metadataDir = await initializedClient({ ...fx, dir: parent }, 'metadata');
    await refreshClient({ metadataDir, metadataUrl: METADATA_URL, now: NOW, fetchImpl: bundleMirror(fx) });
    await assert.doesNotReject(loadTrustedState(metadataDir), `${target}: control`);

    if (target === 'metadata directory') await chown(metadataDir, OTHER_UID, OTHER_UID);
    else if (target === 'ancestor') await chown(parent, OTHER_UID, OTHER_UID);
    else {
      const path = join(metadataDir, target);
      if (target === 'rollback-reset.json') await writePrivate(path, '{"root_version":1}\n');
      await chown(path, OTHER_UID, OTHER_UID);
    }
    await assert.rejects(loadTrustedState(metadataDir), (error) => (
      isInsecure(error) && /owned by another account/.test(error.message)
    ), target);
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
