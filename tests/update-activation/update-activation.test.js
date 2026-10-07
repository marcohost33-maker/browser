// Coupled update transaction: TUF trusted metadata and the active package in one commit.
//
// Every test runs against a real activation store on the local filesystem. Fixtures
// come from a deterministic TUF repository (spike/update-activation/harness).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalBytes, openActivationStore } from '../../spike/activation-store/activation-store.js';
import { DEFAULT_LIMITS } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import {
  applyOfflineUpdate,
  bootstrapUpdateTrust,
  loadUpdateState,
  PACKAGE_MEDIA_TYPE,
  PACKAGE_RESOURCE,
  planOfflineUpdate,
  rollbackPackage,
  TARGET_RECORD_BINDING,
  TARGET_RECORD_SCHEMA,
  TRUST_STATE_SCHEMA,
  UPDATE_BINDINGS,
  verifyInstalledState,
} from '../../spike/update-activation/update-activation.js';
import {
  APP_ID,
  FIXED_NOW,
  packageBytes,
  releaseBundle,
  rootBytes,
  TARGET_PATH,
} from '../../spike/update-activation/harness/tuf-repository.js';

const STORE_ID = 'org.coworkerz.update-activation-test';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const consent = () => true;

const rejectsWith = (code, cause) => (error) => {
  assert.equal(error?.code, code, `expected ${code}, got ${error?.code}: ${error?.message}`);
  if (cause !== undefined) assert.equal(error.details?.cause, cause, `expected cause ${cause}, got ${error.details?.cause}`);
  return true;
};

async function freshStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'update-activation-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'store');
  const store = await openActivationStore({ root, storeId: STORE_ID, create: true });
  return { store, root };
}

function reopen(root) {
  return openActivationStore({ root, storeId: STORE_ID });
}

function apply(store, bundle, options = {}) {
  return applyOfflineUpdate(store, {
    bundle,
    targetPath: TARGET_PATH,
    now: FIXED_NOW,
    approveCapabilityExpansion: consent,
    ...options,
  });
}

async function bootstrapped(t, releases = []) {
  const context = await freshStore(t);
  await bootstrapUpdateTrust(context.store, rootBytes());
  for (const release of releases) await apply(context.store, release);
  return context;
}

function blob(bytes) {
  return { digest: sha256(bytes), size: bytes.length, bytes };
}

// Replaces some update bindings of the current commit directly in the store, keeping
// the others by reference: the way damage or a buggy writer would look on disk.
async function rebind(store, replacements) {
  const status = await store.status();
  const bindings = Object.fromEntries(Object.entries(status.bindings)
    .map(([name, entry]) => [name, { digest: entry.digest, size: entry.size }]));
  for (const [name, value] of Object.entries(replacements)) {
    if (value === null) delete bindings[name];
    else bindings[name] = blob(value);
  }
  return store.commitBindings(bindings, { expectedGeneration: status.generation });
}

// --------------------------------------------------------------------- bootstrap

test('bootstrap binds one self-signed root and refuses to replace existing trust', async (t) => {
  const { store } = await freshStore(t);
  await store.commitBindings({ 'other/config': blob(Buffer.from('kept')) }, { expectedGeneration: 0 });

  const notSelfSigned = rootBytes({ signers: ['rootA'] });
  await assert.rejects(bootstrapUpdateTrust(store, notSelfSigned), rejectsWith('SIGNATURE_THRESHOLD'));
  assert.equal((await store.status()).generation, 1, 'a refused root writes nothing');

  const committed = await bootstrapUpdateTrust(store, rootBytes());
  assert.deepEqual(Object.keys(committed.bindings).sort(), ['other/config', UPDATE_BINDINGS.root]);
  const state = await loadUpdateState(store);
  assert.equal(state.trustedState.root.signed.version, 1);
  assert.deepEqual(state.trustedState.versions, { timestamp: 0, snapshot: 0, targets: 0 });
  assert.equal(state.app, null);
  await assert.rejects(bootstrapUpdateTrust(store, rootBytes()), rejectsWith('UPDATE_TRUST_EXISTS'));

  const empty = await freshStore(t);
  await assert.rejects(loadUpdateState(empty.store), rejectsWith('UPDATE_TRUST_MISSING'));
  await assert.rejects(apply(empty.store, releaseBundle({ appVersion: 1 })), rejectsWith('UPDATE_TRUST_MISSING'));
});

// ------------------------------------------------------------- one transaction

test('an update binds package, metadata and trust state in exactly one commit', async (t) => {
  const { store, root } = await bootstrapped(t);
  const first = await apply(store, releaseBundle({ appVersion: 1 }));
  assert.deepEqual([first.status, first.generation, first.previous], ['activated', 2, null]);

  const before = await store.status();
  const second = await apply(store, releaseBundle({ appVersion: 2 }));
  assert.equal(second.status, 'activated');
  assert.equal(second.generation, before.generation + 1, 'one commit, not two');
  assert.deepEqual([second.active, second.previous], [second.versionId, first.versionId]);
  assert.equal((await store.status()).reason, 'activate');

  // The same commit names the version AND carries the metadata of that version.
  const reopened = await reopen(root);
  const state = await loadUpdateState(reopened);
  assert.equal(state.active, second.versionId);
  assert.deepEqual(state.trustedState.versions, { timestamp: 2, snapshot: 2, targets: 2 });
  assert.equal(state.app.version, 2);
  assert.equal(state.app.digest, sha256(packageBytes(2)));
  const bound = await reopened.readCommitBindings();
  const release = releaseBundle({ appVersion: 2 });
  for (const role of ['timestamp', 'snapshot', 'targets']) {
    assert.ok(bound.bindings[UPDATE_BINDINGS[role]].bytes.equals(release[role]), `${role} is bound byte for byte`);
  }
  const trustState = JSON.parse(bound.bindings[UPDATE_BINDINGS.trustState].bytes.toString('utf8'));
  assert.equal(trustState.schema, TRUST_STATE_SCHEMA);
  assert.equal(trustState.decision.verifiedAt, FIXED_NOW.toISOString());

  // The package is one opaque object whose version record names its authorisation.
  const pkg = await reopened.readResource(PACKAGE_RESOURCE);
  assert.equal(pkg.mediaType, PACKAGE_MEDIA_TYPE);
  assert.ok(pkg.bytes.equals(packageBytes(2)));
  const record = JSON.parse((await reopened.readVersionBindings(second.versionId))[TARGET_RECORD_BINDING].bytes);
  assert.deepEqual(record, {
    schema: TARGET_RECORD_SCHEMA,
    appId: APP_ID,
    appVersion: 2,
    capabilities: ['storage.read'],
    length: packageBytes(2).length,
    sha256: sha256(packageBytes(2)),
    targetPath: TARGET_PATH,
  });

  assert.deepEqual(await verifyInstalledState(reopened), {
    status: 'current',
    generation: second.generation,
    active: second.versionId,
    appId: APP_ID,
    appVersion: 2,
    capabilities: ['storage.read'],
    packageDigest: sha256(packageBytes(2)),
    trustedAppVersion: 2,
    metadataVersions: { root: 1, timestamp: 2, snapshot: 2, targets: 2 },
  });
});

test('the first install and every capability expansion need explicit consent; refusal writes nothing', async (t) => {
  const { store } = await bootstrapped(t);
  await assert.rejects(apply(store, releaseBundle({ appVersion: 1 }), { approveCapabilityExpansion: () => false }),
    rejectsWith('CAPABILITY_ESCALATION'));
  assert.equal((await store.status()).generation, 1);

  await apply(store, releaseBundle({ appVersion: 1 }));
  const asked = [];
  await assert.rejects(apply(store, releaseBundle({ appVersion: 2, capabilities: ['network.fetch', 'storage.read'] }), {
    approveCapabilityExpansion: (request) => {
      asked.push(request.expansion);
      return false;
    },
  }), rejectsWith('CAPABILITY_ESCALATION'));
  assert.deepEqual(asked, [['network.fetch']]);
  assert.equal((await verifyInstalledState(store)).appVersion, 1);
});

test('bound rollback floors reject replayed and rolled-back bundles before anything is staged', async (t) => {
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1 }), releaseBundle({ appVersion: 2 })]);
  const generation = (await store.status()).generation;
  await assert.rejects(apply(store, releaseBundle({ appVersion: 1 })), rejectsWith('TIMESTAMP_ROLLBACK'));
  await assert.rejects(apply(store, releaseBundle({ appVersion: 1, timestampVersion: 3, snapshotVersion: 3, targetsVersion: 3 })),
    rejectsWith('APP_ROLLBACK'));
  await assert.rejects(apply(store, releaseBundle({ appVersion: 3, timestampVersion: 3, snapshotVersion: 1 })),
    rejectsWith('SNAPSHOT_ROLLBACK'));
  assert.deepEqual(await apply(store, releaseBundle({ appVersion: 2 })), { status: 'no-update', committed: false, generation });
  assert.equal((await store.status()).generation, generation);
});

test('a substituted package or a mix-and-match bundle never reaches the store', async (t) => {
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
  const generation = (await store.status()).generation;
  const substituted = releaseBundle({ appVersion: 2 });
  substituted.target = { path: TARGET_PATH, bytes: packageBytes(2, '-evil') };
  await assert.rejects(apply(store, substituted), rejectsWith('TARGET_LENGTH'));

  const mixed = { ...releaseBundle({ appVersion: 2 }), snapshot: releaseBundle({ appVersion: 2, capabilities: [] }).snapshot };
  await assert.rejects(apply(store, mixed), rejectsWith('METADATA_HASH'));
  assert.equal((await store.status()).generation, generation);
});

test('the bytes that were verified are the bytes that are bound, whatever the caller does later', async (t) => {
  const { store } = await bootstrapped(t);
  const release = releaseBundle({ appVersion: 1 });
  const pending = apply(store, release);
  release.target.bytes.fill(0x41);
  release.timestamp.fill(0x20);
  const result = await pending;
  assert.equal(result.status, 'activated');
  assert.ok((await store.readResource(PACKAGE_RESOURCE)).bytes.equals(packageBytes(1)));
  assert.ok((await store.readCommitBindings()).bindings[UPDATE_BINDINGS.timestamp].bytes
    .equals(releaseBundle({ appVersion: 1 }).timestamp));
});

test('oversized inputs and overlong root chains are refused before anything is copied or read', async (t) => {
  const { store } = await bootstrapped(t);
  const generation = (await store.status()).generation;
  const release = releaseBundle({ appVersion: 1 });

  // The count gate runs before a single candidate is touched.
  let touched = 0;
  const roots = new Proxy(new Array(33).fill(rootBytes({ version: 2 })), {
    get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) touched += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  await assert.rejects(apply(store, { ...release, roots }), rejectsWith('TOO_MANY_ROOT_UPDATES'));
  assert.equal(touched, 0);

  // A view that lies about its length cannot slip past the size gate.
  const huge = new Uint8Array(64 * 1024 + 1);
  Object.defineProperty(huge, 'byteLength', { value: 10 });
  Object.defineProperty(huge, 'length', { value: 10 });
  await assert.rejects(apply(store, { ...release, timestamp: huge }), rejectsWith('METADATA_TOO_LARGE'));
  await assert.rejects(apply(store, release, { limits: { ...DEFAULT_LIMITS, targetBytes: 16 } }), rejectsWith('TARGET_TOO_LARGE'));
  await assert.rejects(apply(store, { ...release, snapshot: 'not bytes' }), rejectsWith('INVALID_ARGUMENT'));
  assert.equal((await store.status()).generation, generation);
});

test('a concurrent commit between verification and commit fails the update instead of overwriting', async (t) => {
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
  const stage = store.stageVersion.bind(store);
  store.stageVersion = async (input) => {
    const { generation, bindings } = await store.status();
    const references = Object.fromEntries(Object.entries(bindings).map(([name, entry]) => [name, { digest: entry.digest, size: entry.size }]));
    await store.commitBindings({ ...references, 'other/flag': blob(Buffer.from('x')) }, { expectedGeneration: generation });
    return stage(input);
  };
  await assert.rejects(apply(store, releaseBundle({ appVersion: 2 })), rejectsWith('GENERATION_CONFLICT'));
  store.stageVersion = stage;
  const state = await verifyInstalledState(store);
  assert.deepEqual([state.appVersion, state.metadataVersions.targets], [1, 1]);
  assert.equal((await apply(store, releaseBundle({ appVersion: 2 }))).status, 'activated', 'a retry from the new generation succeeds');
  assert.ok((await store.status()).bindings['other/flag'], 'foreign bindings are carried forward');
});

// ------------------------------------------------------------- rotation, root-only

test('a root that rotates the online keys moves with its metadata; old-key metadata is refused afterwards', async (t) => {
  const { store, root } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
  const root2 = rootBytes({ version: 2, rotateOnline: true });
  const rotated = await apply(store, releaseBundle({ appVersion: 2, roots: [root2], rotateOnline: true }));
  assert.equal(rotated.status, 'activated');
  const state = await loadUpdateState(await reopen(root));
  assert.equal(state.trustedState.root.signed.version, 2);
  assert.ok(state.raw.root.equals(root2));
  await assert.rejects(apply(store, releaseBundle({ appVersion: 3 })), rejectsWith('SIGNATURE_THRESHOLD'));
  assert.equal((await apply(store, releaseBundle({ appVersion: 3, rotateOnline: true }))).status, 'activated');
});

test('a newer root with an unchanged timestamp binds alone, and only if the bound chain still verifies', async (t) => {
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
  const sameKeys = rootBytes({ version: 2 });
  const result = await apply(store, { ...releaseBundle({ appVersion: 1 }), roots: [sameKeys] });
  assert.equal(result.status, 'root-updated');
  const state = await loadUpdateState(store);
  assert.equal(state.trustedState.root.signed.version, 2);
  assert.deepEqual(state.trustedState.versions, { timestamp: 1, snapshot: 1, targets: 1 });

  const rotatedTargets = rootBytes({ version: 3, rotateTargets: true });
  const generation = (await store.status()).generation;
  await assert.rejects(apply(store, { ...releaseBundle({ appVersion: 1 }), roots: [rotatedTargets] }),
    rejectsWith('RETAINED_METADATA_INVALID', 'SIGNATURE_THRESHOLD'));
  assert.equal((await store.status()).generation, generation);
});

// --------------------------------------------------------- rollback and refresh

test('a local rollback moves only the package; floors, metadata and trust state stay', async (t) => {
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1 }), releaseBundle({ appVersion: 2 })]);
  const metadataBefore = (await store.status()).bindings;
  await rollbackPackage(store);
  assert.deepEqual((await store.status()).bindings, metadataBefore);
  const rolledBack = await verifyInstalledState(store);
  assert.deepEqual([rolledBack.status, rolledBack.appVersion, rolledBack.trustedAppVersion], ['rolled-back', 1, 2]);

  // A refresh of v2's metadata keeps the owner's rollback; v1 stays refused.
  const refresh = await apply(store, releaseBundle({ appVersion: 2, timestampVersion: 3, snapshotVersion: 3 }));
  assert.equal(refresh.status, 'metadata-updated');
  const afterRefresh = await verifyInstalledState(store);
  assert.deepEqual([afterRefresh.status, afterRefresh.appVersion, afterRefresh.metadataVersions.timestamp], ['rolled-back', 1, 3]);
  await assert.rejects(apply(store, releaseBundle({ appVersion: 1, timestampVersion: 4, snapshotVersion: 4, targetsVersion: 4 })),
    rejectsWith('APP_ROLLBACK'));

  // Rolling forward is a second local decision; a new release installs normally.
  await rollbackPackage(store);
  assert.equal((await verifyInstalledState(store)).status, 'current');
  const v3 = await apply(store, releaseBundle({ appVersion: 3, timestampVersion: 4, snapshotVersion: 4, targetsVersion: 4 }));
  assert.equal(v3.status, 'activated');
});

test('expiry is evaluated for incoming bundles, never for what is already bound', async (t) => {
  // Valid at FIXED_NOW (install time), expired for any real clock after 2026-10-07T12:30Z,
  // so a loader that consulted the clock would refuse the installed state.
  const soon = '2026-10-07T12:30:00Z';
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1, timestampVersion: 5, expires: soon })]);
  const later = new Date('2026-11-01T00:00:00.000Z');
  // Offline start-up after expiry still works: the installed app keeps running.
  assert.equal((await verifyInstalledState(store)).status, 'current');
  // A stale bundle is refused at the new time; the expired bound state still sets the
  // rollback floors (an equal timestamp version is TUF 5.4.3.1 "no update", a lower
  // one a rollback); a fresh bundle above them is accepted.
  await assert.rejects(apply(store, releaseBundle({ appVersion: 2, timestampVersion: 6, expires: soon }), { now: later }),
    rejectsWith('EXPIRED_METADATA'));
  await assert.rejects(apply(store, releaseBundle({ appVersion: 2, timestampVersion: 4 }), { now: later }),
    rejectsWith('TIMESTAMP_ROLLBACK'));
  assert.equal((await apply(store, releaseBundle({ appVersion: 2, timestampVersion: 5 }), { now: later })).status, 'no-update');
  assert.equal((await apply(store, releaseBundle({ appVersion: 2, timestampVersion: 6 }), { now: later })).status, 'activated');
});

// ------------------------------------------------------------ fail-closed loading

test('a bound chain that does not verify fails closed instead of being reset', async (t) => {
  const v1 = releaseBundle({ appVersion: 1 });
  const v2 = releaseBundle({ appVersion: 2 });
  const cases = [
    ['snapshot from another release', { [UPDATE_BINDINGS.snapshot]: v2.snapshot }, 'METADATA_HASH'],
    ['targets from another release', { [UPDATE_BINDINGS.targets]: v2.targets }, 'METADATA_HASH'],
    ['timestamp signed by a key the root does not name', {
      [UPDATE_BINDINGS.timestamp]: releaseBundle({ appVersion: 1, signers: { timestamp: ['intruder'] } }).timestamp,
    }, 'SIGNATURE_THRESHOLD'],
    ['root that is not self-signed', { [UPDATE_BINDINGS.root]: rootBytes({ signers: ['rootA'] }) }, 'SIGNATURE_THRESHOLD'],
    ['missing targets', { [UPDATE_BINDINGS.targets]: null }, undefined],
    ['missing root', { [UPDATE_BINDINGS.root]: null }, undefined],
  ];
  for (const [label, replacements, cause] of cases) {
    const { store } = await bootstrapped(t, [v1]);
    await rebind(store, replacements);
    await assert.rejects(loadUpdateState(store), rejectsWith('UPDATE_STATE_INVALID', cause), label);
    await assert.rejects(verifyInstalledState(store), rejectsWith('UPDATE_STATE_INVALID', cause), label);
    await assert.rejects(apply(store, v2), rejectsWith('UPDATE_STATE_INVALID', cause), label);
  }
});

test('a trust state that the bound targets metadata does not authorise fails closed', async (t) => {
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
  const original = JSON.parse((await store.readCommitBindings()).bindings[UPDATE_BINDINGS.trustState].bytes);
  const variants = [
    { ...original, app: { ...original.app, version: 2 } },
    { ...original, app: { ...original.app, digest: sha256('other package') } },
    { ...original, app: { ...original.app, capabilities: [] } },
    { ...original, app: { ...original.app, appId: 'org.coworkerz.other' } },
    { ...original, schema: 'browser-update-activation/trust-state/v0' },
  ];
  for (const variant of variants) {
    const { store: target } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
    await rebind(target, { [UPDATE_BINDINGS.trustState]: canonicalBytes(variant) });
    await assert.rejects(loadUpdateState(target), rejectsWith('UPDATE_STATE_INVALID'), JSON.stringify(variant.app));
  }
  await rebind(store, { [UPDATE_BINDINGS.trustState]: Buffer.from(`${JSON.stringify(original)} `) });
  await assert.rejects(loadUpdateState(store), rejectsWith('UPDATE_STATE_INVALID', 'RECORD_INVALID'));
});

test('start-up refuses an active package the bound state did not authorise', async (t) => {
  const { store, root } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
  // A version that was never verified: staged and activated around the update path.
  const rogue = packageBytes(3);
  const record = canonicalBytes({
    schema: TARGET_RECORD_SCHEMA,
    appId: APP_ID,
    appVersion: 3,
    capabilities: ['storage.read'],
    length: rogue.length,
    sha256: sha256(rogue),
    targetPath: TARGET_PATH,
  });
  const { versionId } = await store.stageVersion({
    appVersion: '3',
    packageDigest: sha256(rogue),
    resources: [{ path: PACKAGE_RESOURCE, mediaType: PACKAGE_MEDIA_TYPE, digest: sha256(rogue), size: rogue.length, bytes: rogue }],
    bindings: { [TARGET_RECORD_BINDING]: blob(record) },
  });
  await store.activate(versionId, { expectedGeneration: (await store.status()).generation });
  await assert.rejects(verifyInstalledState(store), rejectsWith('ACTIVE_VERSION_UNAUTHORIZED'));

  // Damage to the active package is reported, never served.
  await rollbackPackage(store);
  const objectPath = store.objectPath(sha256(packageBytes(1)));
  const bytes = await readFile(objectPath);
  bytes[0] ^= 0x01;
  await chmod(objectPath, 0o644);
  await writeFile(objectPath, bytes);
  await assert.rejects(verifyInstalledState(await reopen(root)), rejectsWith('ACTIVE_VERSION_INVALID'));
});

test('documented limit: metadata committed ahead of its package reads as a rollback, never as current', async (t) => {
  // This state is what the two-commit negative control of the crash matrix produces.
  // The coupled protocol never writes it (crash matrix); start-up cannot tell it from
  // a local rollback, but it never reports the stale package as the trusted one.
  const { store } = await bootstrapped(t, [releaseBundle({ appVersion: 1 })]);
  const plan = await planOfflineUpdate(store, { bundle: releaseBundle({ appVersion: 2 }), targetPath: TARGET_PATH, now: FIXED_NOW });
  await store.commitBindings(plan.bindings, { expectedGeneration: plan.state.generation });
  const state = await verifyInstalledState(store);
  assert.deepEqual([state.status, state.appVersion, state.trustedAppVersion], ['rolled-back', 1, 2]);
});
