import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ACTIVATION_SCHEMA,
  canonicalBytes,
  openActivationStore,
  parseCanonicalRecord,
  sha256Hex,
} from '../../spike/activation-store/activation-store.js';
import { createNodeIo } from '../../spike/activation-store/node-io.js';
import { createCrashingIo, createLyingIo, SimulatedCrash } from '../../spike/activation-store/harness/fault-injection.js';
import { versionInput } from '../../spike/activation-store/harness/crash-matrix.js';
import { ModelFs } from '../../spike/activation-store/harness/model-fs.js';

const STORE_ID = 'org.coworkerz.test-app';
const HOST = 'test-host';
const POSIX = process.platform !== 'win32';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function probe(pid, alive = [pid], hostname = HOST) {
  const living = new Set(alive);
  return { pid, hostname, isAlive: (candidate) => living.has(candidate) };
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'activation-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function freshStore(t, options = {}) {
  const directory = await workspace(t);
  const root = join(directory, 'store');
  const store = await openActivationStore({
    root,
    storeId: STORE_ID,
    create: true,
    processProbe: probe(100),
    ...options,
  });
  return { store, root, directory };
}

function reopen(root, options = {}) {
  return openActivationStore({ root, storeId: STORE_ID, processProbe: probe(200), ...options });
}

function bytes(text) {
  return Buffer.from(text, 'utf8');
}

function resource(path, text, mediaType = 'text/plain;charset=utf-8') {
  const content = bytes(text);
  return { path, mediaType, digest: sha256(content), size: content.length, bytes: content };
}

function single(item) {
  return { appVersion: '1.0.0', packageDigest: sha256('package'), resources: [item] };
}

function withPaths(...paths) {
  return {
    appVersion: '1.0.0',
    packageDigest: sha256('package'),
    resources: paths.map((path, index) => resource(path, `content ${index}`)),
  };
}

function blob(text) {
  const content = bytes(text);
  return { digest: sha256(content), size: content.length, bytes: content };
}

// Content-addressed objects only; planted anomalies are checked separately.
async function listObjects(root) {
  const out = [];
  for (const fanout of await readdir(join(root, 'objects'))) {
    if (!/^[0-9a-f]{2}$/.test(fanout)) continue;
    for (const name of await readdir(join(root, 'objects', fanout))) {
      if (/^[0-9a-f]{62}$/.test(name)) out.push(fanout + name);
    }
  }
  return out.sort();
}

// Flips one bit and keeps the length, so only the content hash can detect the damage.
async function corruptObject(store, digest) {
  const path = store.objectPath(digest);
  const content = await readFile(path);
  content[0] ^= 0x01;
  await chmod(path, 0o644);
  await writeFile(path, content);
}

function digestOf(n, path) {
  return versionInput(n).resources.find((item) => item.path === path).digest;
}

async function install(store, n) {
  const { generation } = await store.status();
  const { versionId } = await store.stageVersion(versionInput(n));
  await store.activate(versionId, { expectedGeneration: generation });
  return versionId;
}

const rejectsWith = (code) => (error) => {
  assert.equal(error?.code, code, `expected ${code}, got ${error?.code}: ${error?.message}`);
  return true;
};

// ----------------------------------------------------------------- happy paths

test('stages, activates and serves a version, re-verifying bytes on every read', async (t) => {
  const { store } = await freshStore(t);
  const staged = await store.stageVersion(versionInput(1));
  assert.match(staged.versionId, /^[0-9a-f]{64}$/);
  assert.equal(staged.objectsWritten, 6, 'four resources, one binding and the version record');

  const activated = await store.activate(staged.versionId, { expectedGeneration: 0 });
  assert.equal(activated.changed, true);
  assert.equal(activated.generation, 1);
  assert.equal(activated.active, staged.versionId);
  assert.equal(activated.previous, null);
  // Windows cannot flush directory handles; the post-rename file flush is then the
  // only barrier the platform offers (see node-io.js).
  assert.equal(activated.commitBarrier, POSIX ? 'directory-fsync' : 'file-fsync-only');

  const read = await store.readResource('index.html');
  assert.equal(read.mediaType, 'text/html;charset=utf-8');
  assert.equal(read.bytes.toString('utf8'), '<!doctype html><title>v1</title>\n');

  await corruptObject(store, read.digest);
  await assert.rejects(store.readResource('index.html'), rejectsWith('RESOURCE_INTEGRITY'));
});

test('staging is idempotent and deduplicates identical objects across versions', async (t) => {
  const { store } = await freshStore(t);
  const first = await store.stageVersion(versionInput(1));
  const again = await store.stageVersion(versionInput(1));
  assert.equal(again.versionId, first.versionId);
  assert.equal(again.objectsWritten, 0);
  assert.equal(again.objectsReused, 6);

  const second = await store.stageVersion(versionInput(2));
  assert.notEqual(second.versionId, first.versionId);
  assert.equal(second.objectsReused, 1, 'shared/lib.js is stored once');
  assert.equal(second.objectsWritten, 5);
});

test('streams resource chunks and stops pulling at the first byte beyond the declared size', async (t) => {
  const { store } = await freshStore(t);
  const content = bytes('abcdef');
  async function* parts() {
    yield bytes('abc');
    yield bytes('def');
  }
  const staged = await store.stageVersion(single({
    path: 'stream.bin',
    mediaType: 'application/octet-stream',
    digest: sha256(content),
    size: content.length,
    chunks: parts(),
  }));
  await store.activate(staged.versionId, { expectedGeneration: 0 });
  assert.equal((await store.readResource('stream.bin')).bytes.toString('utf8'), 'abcdef');

  let pulled = 0;
  async function* oversized() {
    yield bytes('ab');
    pulled += 1;
    yield bytes('cd');
    pulled += 1;
    throw new Error('the store kept pulling after the declared size was exceeded');
  }
  await assert.rejects(store.stageVersion(single({
    path: 'big.bin',
    mediaType: 'application/octet-stream',
    digest: sha256('abc'),
    size: 3,
    chunks: oversized(),
  })), rejectsWith('OBJECT_SIZE_MISMATCH'));
  assert.equal(pulled, 1);

  async function* notBytes() {
    yield 'text';
  }
  await assert.rejects(store.stageVersion(single({
    path: 'bad.bin',
    mediaType: 'application/octet-stream',
    digest: sha256('text'),
    size: 4,
    chunks: notBytes(),
  })), rejectsWith('INVALID_ARGUMENT'));
});

// ------------------------------------------------------------------ validation

test('rejects unsafe or ambiguous resource keys before writing a byte', async (t) => {
  const { store, root } = await freshStore(t);
  const invalid = [
    '',
    '/absolute',
    'a//b',
    'trailing/',
    'a/./b',
    'a/../b',
    '..',
    '.',
    'a\\b',
    'query?x',
    'fragment#x',
    'percent%20encoded',
    'nul\u0000byte',
    'c1\u0085control',
    'é.txt',
    '\ud800.js',
    'x'.repeat(1_025),
    Array.from({ length: 65 }, () => 'd').join('/'),
  ];
  for (const path of invalid) {
    await assert.rejects(store.stageVersion(withPaths(path)), rejectsWith('PATH_INVALID'), JSON.stringify(path));
  }
  assert.deepEqual(await listObjects(root), []);
  assert.deepEqual(await readdir(join(root, 'tmp')), []);
});

test('rejects duplicate, case-folded, compatibility-equivalent and tree-conflicting keys', async (t) => {
  const { store, root } = await freshStore(t);
  const cases = [
    [['a.js', 'a.js'], 'PATH_DUPLICATE'],
    [['A.js', 'a.js'], 'PATH_COLLISION'],
    [['ａ.js', 'a.js'], 'PATH_COLLISION'],
    [['ﬁle.txt', 'file.txt'], 'PATH_COLLISION'],
    [['Straße.txt', 'STRASSE.txt'], 'PATH_COLLISION'],
    [['A/c.txt', 'a/b.txt'], 'PATH_COLLISION'],
    [['x/Lib/a.js', 'x/lib/b.js'], 'PATH_COLLISION'],
    [['a', 'a/b'], 'PATH_TREE_CONFLICT'],
    [['A', 'a/b'], 'PATH_TREE_CONFLICT'],
  ];
  for (const [paths, code] of cases) {
    await assert.rejects(store.stageVersion(withPaths(...paths)), rejectsWith(code), JSON.stringify(paths));
  }
  assert.deepEqual(await listObjects(root), []);
});

test('rejects invalid media types, digests, sizes, versions and unexpected fields', async (t) => {
  const { store, root } = await freshStore(t);
  const base = resource('ok.txt', 'ok');
  for (const mediaType of ['text/HTML', 'text', 'text/html; charset=utf-8', 'text/html;charset=latin1', '../x']) {
    await assert.rejects(store.stageVersion(single({ ...base, mediaType })), rejectsWith('MEDIA_TYPE_INVALID'), mediaType);
  }
  for (const digest of ['ABC', 'g'.repeat(64), base.digest.toUpperCase(), 42]) {
    await assert.rejects(store.stageVersion(single({ ...base, digest })), rejectsWith('INVALID_ARGUMENT'), String(digest));
  }
  for (const size of [-1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.stageVersion(single({ ...base, size })), rejectsWith('INVALID_ARGUMENT'), String(size));
  }
  const { bytes: _omitted, ...withoutSource } = base;
  const invalidInputs = [
    single({ ...base, extra: true }),
    single(withoutSource),
    single({ ...base, chunks: [] }),
    single({ ...base, bytes: 'not bytes' }),
    { ...single(base), appVersion: 'has space' },
    { ...single(base), packageDigest: 'nope' },
    { ...single(base), unexpected: 1 },
    { appVersion: '1', packageDigest: sha256('p'), resources: [] },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(store.stageVersion(input), rejectsWith('INVALID_ARGUMENT'));
  }
  assert.deepEqual(await listObjects(root), []);
});

test('enforces count, per-resource and aggregate limits before allocation', async (t) => {
  const { store, root } = await freshStore(t, { limits: { resources: 2, resourceBytes: 16, totalBytes: 20 } });
  await assert.rejects(store.stageVersion(withPaths('a', 'b', 'c')), rejectsWith('LIMIT_EXCEEDED'));
  await assert.rejects(store.stageVersion(single(resource('big', 'x'.repeat(17)))), rejectsWith('LIMIT_EXCEEDED'));
  await assert.rejects(store.stageVersion({
    appVersion: '1',
    packageDigest: sha256('p'),
    resources: [resource('a', 'x'.repeat(12)), resource('b', 'y'.repeat(12))],
  }), rejectsWith('LIMIT_EXCEEDED'));
  assert.deepEqual(await listObjects(root), []);

  const directory = await workspace(t);
  await assert.rejects(openActivationStore({
    root: join(directory, 's'),
    storeId: STORE_ID,
    create: true,
    limits: { unknownLimit: 1 },
  }), rejectsWith('INVALID_LIMIT'));
  await assert.rejects(openActivationStore({
    root: join(directory, 's'),
    storeId: STORE_ID,
    create: true,
    limits: { resources: 0 },
  }), rejectsWith('INVALID_LIMIT'));
});

test('a declared digest mismatch leaves nothing activatable and only collectable garbage', async (t) => {
  const { store, root } = await freshStore(t);
  const input = versionInput(1);
  const index = input.resources.findIndex((item) => item.path === 'shared/lib.js');
  input.resources[index] = { ...input.resources[index], digest: sha256('something else') };
  await assert.rejects(store.stageVersion(input), rejectsWith('OBJECT_DIGEST_MISMATCH'));

  assert.equal((await store.status()).generation, 0);
  assert.deepEqual(await readdir(join(root, 'tmp')), []);
  const orphans = await listObjects(root);
  assert.equal(orphans.length, 3, 'objects sorted before the failing one were written');
  const report = await store.recover();
  assert.equal(report.gc.removedObjects, 3);
  assert.deepEqual(await listObjects(root), []);
});

// ---------------------------------------------------------------- commit protocol

test('activation is compare-and-swap on the generation the caller observed', async (t) => {
  const { store } = await freshStore(t);
  const { versionId: v1 } = await store.stageVersion(versionInput(1));
  await assert.rejects(store.activate(v1, { expectedGeneration: 1 }), rejectsWith('GENERATION_CONFLICT'));
  await assert.rejects(store.activate(v1, {}), rejectsWith('INVALID_ARGUMENT'));
  assert.equal((await store.status()).generation, 0);

  await store.activate(v1, { expectedGeneration: 0 });
  const { versionId: v2 } = await store.stageVersion(versionInput(2));
  await assert.rejects(store.activate(v2, { expectedGeneration: 0 }), rejectsWith('GENERATION_CONFLICT'));
  const result = await store.activate(v2, { expectedGeneration: 1 });
  assert.equal(result.previous, v1);
  assert.equal(result.generation, 2);
});

test('re-activating the active version is an idempotent no-op, even with a stale generation', async (t) => {
  const { store } = await freshStore(t);
  const v1 = await install(store, 1);
  const again = await store.activate(v1, { expectedGeneration: 0 });
  assert.equal(again.changed, false);
  assert.equal(again.generation, 1);
  assert.equal(again.active, v1);
});

test('refuses to activate a missing, corrupt or foreign-namespace version', async (t) => {
  const { store, directory } = await freshStore(t);
  await assert.rejects(store.activate(sha256('missing'), { expectedGeneration: 0 }), (error) => {
    assert.equal(error.code, 'VERSION_INVALID');
    assert.equal(error.details.problems[0].code, 'VERSION_MISSING');
    return true;
  });

  const { versionId } = await store.stageVersion(versionInput(1));
  await corruptObject(store, digestOf(1, 'app.js'));
  await assert.rejects(store.activate(versionId, { expectedGeneration: 0 }), (error) => {
    assert.equal(error.code, 'VERSION_INVALID');
    assert.deepEqual(error.details.problems, [{ code: 'OBJECT_CORRUPT', ref: 'app.js' }]);
    return true;
  });

  const foreign = await openActivationStore({
    root: join(directory, 'foreign'),
    storeId: 'org.coworkerz.other-app',
    create: true,
    processProbe: probe(300),
  });
  const { versionId: foreignId } = await foreign.stageVersion(versionInput(2));
  const target = store.objectPath(foreignId);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, await readFile(foreign.objectPath(foreignId)));
  await assert.rejects(store.activate(foreignId, { expectedGeneration: 0 }), (error) => {
    assert.equal(error.code, 'VERSION_INVALID');
    assert.equal(error.details.problems[0].code, 'NAMESPACE_MISMATCH');
    return true;
  });
  assert.equal((await store.status()).generation, 0);
});

test('rollback restores the verified last-good version and can roll forward again', async (t) => {
  const { store } = await freshStore(t);
  const v1 = await install(store, 1);
  const v2 = await install(store, 2);
  await store.commitBindings({ 'update/timestamp': blob('ts') }, { expectedGeneration: 2 });

  const back = await store.rollback({ expectedGeneration: 3 });
  assert.deepEqual([back.active, back.previous, back.generation, back.reason], [v1, v2, 4, 'rollback']);
  assert.deepEqual(Object.keys(back.bindings), ['update/timestamp'], 'update metadata never rolls back');
  assert.equal((await store.readResource('index.html')).bytes.toString('utf8'), '<!doctype html><title>v1</title>\n');

  const forward = await store.rollback({ expectedGeneration: 4 });
  assert.deepEqual([forward.active, forward.previous], [v2, v1]);
});

test('rollback fails closed without a verified last-good version', async (t) => {
  const { store } = await freshStore(t);
  await assert.rejects(store.rollback({ expectedGeneration: 0 }), rejectsWith('NO_LAST_GOOD'));
  await install(store, 1);
  await assert.rejects(store.rollback({ expectedGeneration: 1 }), rejectsWith('NO_LAST_GOOD'));
  await install(store, 2);
  await corruptObject(store, digestOf(1, 'index.html'));
  await assert.rejects(store.rollback({ expectedGeneration: 2 }), rejectsWith('LAST_GOOD_INVALID'));
  assert.equal((await store.status()).generation, 2);
});

test('activation keeps an older verified last-good when the displaced version is corrupt', async (t) => {
  const { store } = await freshStore(t);
  const v1 = await install(store, 1);
  await install(store, 2);
  await corruptObject(store, digestOf(2, 'index.html'));
  const { versionId: v3 } = await store.stageVersion(versionInput(3));
  const result = await store.activate(v3, { expectedGeneration: 2 });
  assert.equal(result.previous, v1);
});

// ------------------------------------------------------------ corruption handling

test('recovery reports a corrupt active version fail-closed and never switches or deletes', async (t) => {
  const { store, root } = await freshStore(t);
  const v1 = await install(store, 1);
  const v2 = await install(store, 2);
  await corruptObject(store, digestOf(2, 'index.html'));
  const before = await listObjects(root);

  const report = await store.recover();
  assert.equal(report.activeValid, false);
  assert.equal(report.previousValid, true);
  assert.equal(report.rollbackAvailable, true);
  assert.deepEqual(report.gc.skipped, { reason: 'invalid-root' });
  assert.deepEqual(report.activeProblems, [{ code: 'OBJECT_CORRUPT', ref: 'index.html' }]);
  assert.equal((await store.status()).active, v2, 'recovery never switches versions on its own');
  assert.deepEqual(await listObjects(root), before, 'nothing is deleted while a root is invalid');
  await assert.rejects(store.readResource('index.html'), rejectsWith('RESOURCE_INTEGRITY'));

  const back = await store.rollback({ expectedGeneration: 2 });
  assert.deepEqual([back.active, back.previous], [v1, null], 'a corrupt version is never kept as last-good');
});

test('a corrupt shared object is repaired by the next staging of the same content', async (t) => {
  const { store } = await freshStore(t);
  await install(store, 1);
  await corruptObject(store, digestOf(1, 'shared/lib.js'));
  assert.equal((await store.recover()).activeValid, false);

  const staged = await store.stageVersion(versionInput(2));
  assert.equal(staged.objectsRepaired, 1);
  assert.equal((await store.recover()).activeValid, true);
});

test('an object address occupied by a directory or link fails closed and is left as evidence', async (t) => {
  const { store, directory } = await freshStore(t);
  const digest = digestOf(1, 'index.html');
  const target = store.objectPath(digest);
  await mkdir(target, { recursive: true });
  await assert.rejects(store.stageVersion(versionInput(1)), rejectsWith('STORE_LAYOUT_INVALID'));
  assert.equal((await readdir(target)).length, 0, 'the occupying directory is untouched');

  if (POSIX) {
    await rm(target, { recursive: true });
    const decoy = join(directory, 'decoy');
    await writeFile(decoy, 'decoy');
    await symlink(decoy, target);
    await assert.rejects(store.stageVersion(versionInput(1)), rejectsWith('STORE_LAYOUT_INVALID'));
    assert.equal(await readFile(decoy, 'utf8'), 'decoy', 'the link target is never written');
  }
});

// ----------------------------------------------- regressions of CWAP v0.1.1 review

test('regression P1-RECOVERY-1: retention follows the commit, not the highest orphan', async (t) => {
  const { store } = await freshStore(t);
  const v1 = await install(store, 1);
  const v2 = await install(store, 2);
  const orphan = { ...versionInput(9), appVersion: '9.9.9' };
  const { versionId: v9 } = await store.stageVersion(orphan);
  const { versionId: v3 } = await store.stageVersion(versionInput(3));

  const result = await store.activate(v3, { expectedGeneration: 2 });
  assert.deepEqual([result.active, result.previous], [v3, v2]);
  assert.equal((await store.verifyVersion(v2)).ok, true, 'the actual last-good survives');
  await assert.rejects(store.readVersion(v9), rejectsWith('VERSION_MISSING'));
  await assert.rejects(store.readVersion(v1), rejectsWith('VERSION_MISSING'));
});

test('regression P1-RECOVERY-2: an interrupted publish is retried without a wedge', async (t) => {
  const { store, root } = await freshStore(t);
  const v1 = await install(store, 1);
  const { versionId: v2 } = await store.stageVersion(versionInput(2));

  const crashing = createCrashingIo(createNodeIo(), {
    crashWhen: (kind, path) => kind === 'rename' && path.endsWith(join('state', 'CURRENT')),
  });
  const dying = await reopen(root, { io: crashing.io, processProbe: probe(401) });
  await assert.rejects(dying.activate(v2, { expectedGeneration: 1 }), (error) => error instanceof SimulatedCrash);

  const survivor = await reopen(root, { processProbe: probe(402) });
  await assert.rejects(survivor.stageVersion(versionInput(2)), rejectsWith('STORE_LOCKED'));
  const report = await survivor.recover();
  assert.equal(report.brokeStaleLock, true);
  assert.equal(report.active, v1, 'the interrupted publish left the old state');

  const { versionId } = await survivor.stageVersion(versionInput(2));
  assert.equal(versionId, v2);
  const retried = await survivor.activate(v2, { expectedGeneration: 1 });
  assert.deepEqual([retried.active, retried.previous], [v2, v1]);
});

// ----------------------------------------------------------------------- locking

async function plantLock(root, holder, raw = null) {
  const content = raw ?? canonicalBytes({ schema: ACTIVATION_SCHEMA.lock, token: 'f'.repeat(32), ...holder });
  await writeFile(join(root, 'state', 'LOCK'), content);
}

test('a live writer lock is never broken; a provably stale one only by recovery', async (t) => {
  const { root } = await freshStore(t);
  await plantLock(root, { pid: 111, hostname: HOST });

  const contender = await reopen(root, { processProbe: probe(222, [111, 222]) });
  await assert.rejects(contender.stageVersion(versionInput(1)), rejectsWith('STORE_LOCKED'));
  await assert.rejects(contender.recover(), rejectsWith('STORE_LOCKED'));

  const successor = await reopen(root, { processProbe: probe(333) });
  await assert.rejects(successor.stageVersion(versionInput(1)), rejectsWith('STORE_LOCKED'));
  const report = await successor.recover();
  assert.equal(report.brokeStaleLock, true);
  assert.equal((await readdir(join(root, 'state'))).includes('LOCK'), false);
  await assert.rejects(successor.recover({ breakStaleLock: 'sometimes' }), rejectsWith('INVALID_ARGUMENT'));
});

test('a foreign-host or unreadable lock is only broken by an explicit force', async (t) => {
  const { root } = await freshStore(t);
  await plantLock(root, { pid: 111, hostname: 'other-host' });
  const store = await reopen(root, { processProbe: probe(333) });
  await assert.rejects(store.recover(), rejectsWith('STORE_LOCKED'));
  assert.equal((await store.recover({ breakStaleLock: 'force' })).brokeStaleLock, true);

  await plantLock(root, null, bytes('not a lock record'));
  await assert.rejects(store.recover(), (error) => {
    assert.equal(error.code, 'STORE_LOCKED');
    assert.equal(error.details.holder, 'unreadable');
    return true;
  });
  assert.equal((await store.recover({ breakStaleLock: 'force' })).brokeStaleLock, true);
});

test('a lock replaced by another actor during an operation is not deleted on release', async (t) => {
  const { root } = await freshStore(t);
  const io = createNodeIo();
  const foreign = canonicalBytes({ schema: ACTIVATION_SCHEMA.lock, pid: 999, hostname: HOST, token: 'e'.repeat(32) });
  let replaced = false;
  const intercepting = {
    ...io,
    async readFile(path, maxBytes) {
      if (!replaced && path.endsWith(join('state', 'LOCK'))) {
        replaced = true;
        await writeFile(path, foreign);
      }
      return io.readFile(path, maxBytes);
    },
  };
  const store = await reopen(root, { io: intercepting, processProbe: probe(444) });
  await store.stageVersion(versionInput(1));
  assert.equal(replaced, true);
  assert.equal(store.lockLost, true);
  assert.deepEqual(await readFile(join(root, 'state', 'LOCK')), foreign);
});

// ------------------------------------------------------------------ layout damage

test('store layout damage fails closed instead of being silently healed', async (t) => {
  const directory = await workspace(t);
  const root = join(directory, 'store');
  await assert.rejects(reopen(root), rejectsWith('STORE_NOT_INITIALIZED'));
  await openActivationStore({ root, storeId: STORE_ID, create: true });
  await assert.rejects(openActivationStore({ root, storeId: 'org.coworkerz.other' }), rejectsWith('STORE_ID_MISMATCH'));

  if (POSIX) {
    const linked = join(directory, 'linked-store');
    await symlink(root, linked);
    await assert.rejects(reopen(linked), rejectsWith('STORE_ROOT_INVALID'));
    await chmod(root, 0o777);
    await assert.rejects(reopen(root), rejectsWith('STORE_ROOT_INVALID'));
    await chmod(root, 0o700);
  }

  await rename(join(root, 'state'), join(directory, 'state-moved'));
  await assert.rejects(reopen(root), rejectsWith('STORE_LAYOUT_INVALID'));
  await assert.rejects(reopen(root, { create: true }), rejectsWith('STORE_LAYOUT_INVALID'), 'create never heals damage');
  if (POSIX) {
    await symlink(join(directory, 'state-moved'), join(root, 'state'));
    await assert.rejects(reopen(root), rejectsWith('STORE_LAYOUT_INVALID'));
    await rm(join(root, 'state'));
  }
  await rename(join(directory, 'state-moved'), join(root, 'state'));
  await reopen(root);

  await chmod(join(root, 'STORE'), 0o600);
  await writeFile(join(root, 'STORE'), '{"schema":"something-else","storeId":"x"}');
  await assert.rejects(reopen(root), rejectsWith('STORE_LAYOUT_INVALID'));
});

test('initialisation refuses to adopt foreign content that recovery would delete', async (t) => {
  const directory = await workspace(t);
  const root = join(directory, 'user-folder');
  await mkdir(join(root, 'tmp'), { recursive: true });
  await writeFile(join(root, 'tmp', 'important.txt'), 'user data');
  await assert.rejects(openActivationStore({ root, storeId: STORE_ID, create: true }), rejectsWith('STORE_ROOT_INVALID'));
  assert.equal(await readFile(join(root, 'tmp', 'important.txt'), 'utf8'), 'user data');
  assert.equal((await readdir(root)).includes('STORE'), false);

  await assert.rejects(openActivationStore({
    root: join(directory, 'missing-parent', 'store'),
    storeId: STORE_ID,
    create: true,
  }), rejectsWith('STORE_ROOT_INVALID'));

  const interrupted = join(directory, 'interrupted');
  await mkdir(join(interrupted, 'objects'), { recursive: true });
  await mkdir(join(interrupted, 'tmp'));
  const store = await openActivationStore({ root: interrupted, storeId: STORE_ID, create: true });
  assert.equal((await store.status()).generation, 0, 'empty directories of an interrupted initialisation are adopted');
});

test('tampered, non-canonical, linked or foreign commit records fail closed', async (t) => {
  const { store, root, directory } = await freshStore(t);
  await install(store, 1);
  const currentPath = join(root, 'state', 'CURRENT');
  const original = await readFile(currentPath);
  const commit = parseCanonicalRecord(original);
  const reseal = (value) => {
    const { checksum, ...body } = value;
    return canonicalBytes({ ...body, checksum: sha256Hex(canonicalBytes(body)) });
  };

  const attempts = [
    ['checksum mismatch', canonicalBytes({ ...commit, generation: 7 }), 'COMMIT_INVALID'],
    ['non-canonical bytes', Buffer.concat([bytes(' '), reseal(commit)]), 'COMMIT_INVALID'],
    ['previous equals active', reseal({ ...commit, previous: commit.active }), 'COMMIT_INVALID'],
    ['unknown reason', reseal({ ...commit, reason: 'magic' }), 'COMMIT_INVALID'],
    ['foreign store', reseal({ ...commit, storeId: 'org.coworkerz.other' }), 'NAMESPACE_MISMATCH'],
  ];
  for (const [label, content, code] of attempts) {
    await writeFile(currentPath, content);
    await assert.rejects(store.status(), rejectsWith(code), label);
    await assert.rejects(store.recover(), rejectsWith(code), label);
  }

  if (POSIX) {
    const elsewhere = join(directory, 'valid-commit');
    await writeFile(elsewhere, original);
    await rm(currentPath);
    await symlink(elsewhere, currentPath);
    await assert.rejects(store.status(), rejectsWith('COMMIT_INVALID'), 'a linked commit is never followed');
    await rm(currentPath);
  }
  await writeFile(currentPath, original);
  assert.equal((await store.status()).generation, 1);
});

test('the canonical record parser accepts exactly one byte form per value', () => {
  const canonical = bytes('{"a":1,"b":[true,null,"x"]}');
  assert.deepEqual(parseCanonicalRecord(canonical), { a: 1, b: [true, null, 'x'] });
  const rejected = [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical]),
    bytes('{"a":1,"a":1}'),
    bytes('{"b":1,"a":2}'),
    bytes('{ "a":1}'),
    bytes('{"a":1.0}'),
    bytes('{"a":1e0}'),
    bytes('{"a":-0}'),
    bytes('{"a":9007199254740992}'),
    bytes('{"a":"\\u0041"}'),
    bytes('{"a":"\\ud800"}'),
    Buffer.from([0x7b, 0xff, 0x7d]),
    bytes('not json'),
    bytes(`${'['.repeat(20)}${']'.repeat(20)}`),
  ];
  for (const candidate of rejected) {
    assert.throws(() => parseCanonicalRecord(candidate), rejectsWith('RECORD_INVALID'), candidate.toString('utf8'));
  }
  assert.throws(() => parseCanonicalRecord(canonical, undefined, 4), rejectsWith('RECORD_INVALID'));
});

// ------------------------------------------------------------------- bindings

test('commit bindings are atomic with the pointer and must reference valid objects', async (t) => {
  const { store } = await freshStore(t);
  const early = await store.commitBindings({ 'update/root': blob('root v1') }, { expectedGeneration: 0 });
  assert.deepEqual([early.active, early.generation, early.reason], [null, 1, 'bind']);

  const v1 = await install(store, 1);
  const timestamp = blob('timestamp');
  const bound = await store.commitBindings({ 'update/timestamp': timestamp }, { expectedGeneration: 2 });
  assert.deepEqual([bound.active, bound.previous, bound.reason], [v1, null, 'bind']);
  assert.deepEqual(Object.keys(bound.bindings), ['update/timestamp'], 'bindings are replaced as a whole');

  const reference = await store.commitBindings({
    'update/timestamp': { digest: timestamp.digest, size: timestamp.size },
  }, { expectedGeneration: 3 });
  assert.equal(reference.generation, 4);

  await assert.rejects(store.commitBindings({
    'update/missing': { digest: sha256('absent'), size: 6 },
  }, { expectedGeneration: 4 }), rejectsWith('BINDING_INVALID'));
  for (const name of ['Update/x', '../x', 'a//b', '.hidden', 'x'.repeat(129)]) {
    await assert.rejects(store.commitBindings({ [name]: blob('x') }, { expectedGeneration: 4 }), rejectsWith('BINDING_INVALID'), name);
  }
  await assert.rejects(store.commitBindings({ 'update/x': { ...blob('x'), digest: sha256('y') } }, { expectedGeneration: 4 }), rejectsWith('OBJECT_DIGEST_MISMATCH'));
  await assert.rejects(store.commitBindings('nope', { expectedGeneration: 4 }), rejectsWith('BINDING_INVALID'));
  assert.equal((await store.status()).generation, 4);

  const { versionId: v2 } = await store.stageVersion(versionInput(2));
  const together = await store.activate(v2, { expectedGeneration: 4, bindings: { 'update/snapshot': blob('snapshot') } });
  assert.deepEqual([together.active, together.previous], [v2, v1]);
  assert.deepEqual(Object.keys(together.bindings), ['update/snapshot']);
});

test('version bindings must carry their bytes', async (t) => {
  const { store } = await freshStore(t);
  const input = versionInput(1);
  const manifest = input.bindings['package/manifest'];
  input.bindings = { 'package/manifest': { digest: manifest.digest, size: manifest.size } };
  await assert.rejects(store.stageVersion(input), rejectsWith('BINDING_INVALID'));
});

// ------------------------------------------------------------ garbage collection

test('garbage collection leaves unknown entries alone and skips when a root is unreadable', async (t) => {
  const { store, root } = await freshStore(t);
  const v1 = await install(store, 1);
  await install(store, 2);
  await writeFile(join(root, 'objects', 'not-a-fanout'), 'x');
  await mkdir(join(root, 'objects', 'ab'), { recursive: true });
  await writeFile(join(root, 'objects', 'ab', 'not-an-object'), 'x');

  const report = await store.collectGarbage();
  assert.deepEqual(report.anomalies.map((entry) => entry.path).sort(), ['objects/ab/not-an-object', 'objects/not-a-fanout']);
  assert.equal(await readFile(join(root, 'objects', 'not-a-fanout'), 'utf8'), 'x');

  await corruptObject(store, v1);
  const before = await listObjects(root);
  const skipped = await store.collectGarbage();
  assert.equal(skipped.skipped.reason, 'root-unreadable');
  assert.deepEqual(await listObjects(root), before);
});

// ------------------------------------------------------------- barriers and reads

test('reports which barrier held where directories cannot be synced', async () => {
  const machine = new ModelFs({ directorySync: false });
  await machine.io().mkdir('/apps');
  const io = machine.io();
  const store = await openActivationStore({ root: '/apps/store', storeId: STORE_ID, io, create: true, processProbe: probe(500) });
  const { versionId } = await store.stageVersion(versionInput(1));
  assert.equal((await store.activate(versionId, { expectedGeneration: 0 })).commitBarrier, 'file-fsync-only');
  assert.equal((await store.recover()).commitBarrier, 'file-fsync-only');

  const nothing = { ...io, syncFile: async () => false };
  const bare = await openActivationStore({ root: '/apps/store', storeId: STORE_ID, io: nothing, processProbe: probe(501) });
  assert.equal((await bare.commitBindings({ 'update/x': blob('x') }, { expectedGeneration: 1 })).commitBarrier, 'unavailable');
  assert.equal((await bare.recover()).commitBarrier, 'unavailable');
});

test('a commit re-establishes the directory barriers of every object it references', async () => {
  // Staging by a process whose object-directory syncs were acknowledged but never
  // performed: everything is visible, nothing under objects/ is durable.
  const machine = new ModelFs({ directorySync: true });
  await machine.io().mkdir('/apps');
  await openActivationStore({ root: '/apps/store', storeId: STORE_ID, io: machine.io(), create: true, processProbe: probe(509) });
  machine.checkpoint();
  const lying = createLyingIo(machine.io(), { skipDirectorySync: (path) => path.includes('/objects') });
  const stager = await openActivationStore({ root: '/apps/store', storeId: STORE_ID, io: lying, processProbe: probe(510) });
  const { versionId } = await stager.stageVersion(versionInput(1));

  const activator = await openActivationStore({ root: '/apps/store', storeId: STORE_ID, io: machine.io(), processProbe: probe(511) });
  await activator.activate(versionId, { expectedGeneration: 0 });

  // Power loss that keeps nothing beyond the mandatory (synced) entries.
  const survivor = machine.posixStrictState(() => 0);
  const store = await openActivationStore({ root: '/apps/store', storeId: STORE_ID, io: survivor.io(), processProbe: probe(512) });
  assert.equal((await store.status()).active, versionId);
  assert.equal((await store.verifyVersion(versionId)).ok, true, 'the commit must not depend on how its objects arrived');
});

test('verification streams objects through the hash instead of loading them', async (t) => {
  const { store, root } = await freshStore(t);
  const { versionId } = await store.stageVersion(versionInput(1));
  const io = createNodeIo();
  const calls = { readFile: 0, digestFile: 0 };
  const counting = {
    ...io,
    async readFile(path, maxBytes) {
      if (path.startsWith(join(root, 'objects'))) calls.readFile += 1;
      return io.readFile(path, maxBytes);
    },
    async digestFile(path, maxBytes) {
      calls.digestFile += 1;
      return io.digestFile(path, maxBytes);
    },
  };
  const observer = await reopen(root, { io: counting, processProbe: probe(520) });
  assert.equal((await observer.verifyVersion(versionId)).ok, true);
  assert.deepEqual(calls, { readFile: 1, digestFile: 5 }, 'only the version record is loaded; four resources and one binding are streamed');

  await corruptObject(store, digestOf(1, 'app.js'));
  assert.deepEqual((await observer.verifyVersion(versionId)).problems, [{ code: 'OBJECT_CORRUPT', ref: 'app.js' }]);
  await assert.rejects(io.digestFile(join(root, 'STORE'), 3), (error) => error.code === 'EFBIG');
  assert.equal(await io.digestFile(join(root, 'absent'), 3), null);
});

test('a read racing a commit and collection is retried once against the new commit', async (t) => {
  const { store, root } = await freshStore(t);
  const v1 = await install(store, 1);
  const stale = await readFile(join(root, 'state', 'CURRENT'));
  await install(store, 2);
  const v3 = await install(store, 3);
  await assert.rejects(store.readVersion(v1), rejectsWith('VERSION_MISSING'), 'v1 was collected');

  const io = createNodeIo();
  let staleReads = 0;
  const racing = (limit) => ({
    ...io,
    async readFile(path, maxBytes) {
      if (path === join(root, 'state', 'CURRENT') && staleReads < limit) {
        staleReads += 1;
        return Buffer.from(stale);
      }
      return io.readFile(path, maxBytes);
    },
  });
  const reader = await reopen(root, { io: racing(1), processProbe: probe(530) });
  const read = await reader.readResource('index.html');
  assert.equal(read.versionId, v3);
  assert.equal(read.bytes.toString('utf8'), '<!doctype html><title>v3</title>\n');

  staleReads = 0;
  const stuck = await reopen(root, { io: racing(Number.POSITIVE_INFINITY), processProbe: probe(531) });
  await assert.rejects(stuck.readResource('index.html'), rejectsWith('VERSION_MISSING'), 'an unchanged generation is real damage');
});

test('a store root owned by another account is refused', { skip: !POSIX }, async (t) => {
  const { root } = await freshStore(t);
  const io = createNodeIo();
  const foreign = { ...io, currentUserId: io.currentUserId + 1 };
  await assert.rejects(reopen(root, { io: foreign }), rejectsWith('STORE_ROOT_INVALID'));
  await reopen(root, { io: { ...io, currentUserId: null } }, 'an unknown account is not a mismatch');
});

test('resource reads fail closed for unknown keys, no activation and invalid keys', async (t) => {
  const { store } = await freshStore(t);
  await assert.rejects(store.readResource('index.html'), rejectsWith('NO_ACTIVE_VERSION'));
  const v1 = await install(store, 1);
  await install(store, 2);
  await assert.rejects(store.readResource('missing.txt'), rejectsWith('RESOURCE_NOT_FOUND'));
  await assert.rejects(store.readResource('../index.html'), rejectsWith('PATH_INVALID'));
  const old = await store.readResource('index.html', { versionId: v1 });
  assert.equal(old.bytes.toString('utf8'), '<!doctype html><title>v1</title>\n');
});

test('the node adapter never follows links and bounds reads', { skip: !POSIX }, async (t) => {
  const directory = await workspace(t);
  const io = createNodeIo();
  const file = join(directory, 'file');
  const link = join(directory, 'link');
  await writeFile(file, 'content');
  await symlink(file, link);
  await assert.rejects(io.readFile(link, 100), (error) => error.code === 'ELOOP');
  await assert.rejects(io.createExclusive(link, 0o600), (error) => error.code === 'EEXIST');
  await assert.rejects(io.readFile(file, 3), (error) => error.code === 'EFBIG');
  assert.equal(await io.readFile(join(directory, 'absent'), 3), null);
  assert.equal(await io.link(file, link), false);
  assert.equal(await readFile(file, 'utf8'), 'content');
});
