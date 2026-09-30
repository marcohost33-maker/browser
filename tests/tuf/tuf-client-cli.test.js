import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
} from 'node:crypto';
import fsPromises, {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  atomicWriteFile,
  downloadTargets,
  fetchBounded,
  initClient,
  loadTrustedState,
  refreshClient,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import {
  parseTufMetadataBytes,
} from '../../spike/tuf-offline-metadata/strict-json.js';
import {
  canonicalBytes,
  DEFAULT_LIMITS,
  keyIdFor,
  sha256,
} from '../../spike/tuf-offline-metadata/tuf-offline.js';

const GENERATOR = 'spike/tuf-offline-metadata/differential/generate-corpus.mjs';
const CLI = 'spike/tuf-offline-metadata/client/tuf-client-cli.mjs';
const NOW = new Date('2026-09-27T19:45:00.000Z');
const METADATA_URL = 'https://repo.test/metadata/';
const TARGET_URL = 'https://repo.test/targets/';

function decode(value) {
  return Buffer.from(value, 'base64');
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-client-'));
  const corpusPath = join(dir, 'corpus.json');
  execFileSync(process.execPath, [GENERATOR, corpusPath], { stdio: 'ignore' });
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  const item = corpus.cases.find((entry) => entry.name === 'valid-pretty-envelope');
  if (!item) throw new Error('valid differential fixture missing');

  return {
    dir,
    item,
    corpus,
    root: decode(item.trusted_root_b64),
    timestamp: decode(item.timestamp_b64),
    snapshot: decode(item.snapshot_b64),
    targets: decode(item.targets_b64),
  };
}

// Same deterministic Ed25519 derivation as the corpus generator, so rebuilt
// metadata verifies against the corpus root. rebuildChain(fx) without mutations
// must reproduce the generator's bytes exactly (asserted where it is used).
const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function corpusSigner(name) {
  const seed = Buffer.from(sha256(`browser-tuf-differential-key:${name}`), 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicHex = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('hex');
  const keyId = keyIdFor({ keytype: 'ed25519', scheme: 'ed25519', keyval: { public: publicHex } });
  return { privateKey, keyId };
}

function resignedRaw(metadata, signerName) {
  const signer = corpusSigner(signerName);
  metadata.signatures = [{
    keyid: signer.keyId,
    sig: signBytes(null, canonicalBytes(metadata.signed), signer.privateKey).toString('hex'),
  }];
  return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function fileDescriptor(raw, version) {
  return { version, length: raw.length, hashes: { sha256: sha256(raw) } };
}

function rebuildChain(fx, {
  mutateTargets = () => {},
  mutateSnapshot = () => {},
  mutateTimestamp = () => {},
} = {}) {
  const targets = parseTufMetadataBytes(fx.targets);
  mutateTargets(targets);
  const targetsRaw = resignedRaw(targets, 'targetsA');

  const snapshot = parseTufMetadataBytes(fx.snapshot);
  snapshot.signed.meta['targets.json'] = fileDescriptor(targetsRaw, targets.signed.version);
  mutateSnapshot(snapshot);
  const snapshotRaw = resignedRaw(snapshot, 'snapshotA');

  const timestamp = parseTufMetadataBytes(fx.timestamp);
  timestamp.signed.meta['snapshot.json'] = fileDescriptor(snapshotRaw, snapshot.signed.version);
  mutateTimestamp(timestamp);
  const timestampRaw = resignedRaw(timestamp, 'timestampA');

  return { timestamp: timestampRaw, snapshot: snapshotRaw, targets: targetsRaw };
}

async function writeTrustedState(metadataDir, files) {
  await mkdir(metadataDir, { recursive: true });
  for (const [role, bytes] of Object.entries(files)) {
    await writeFile(join(metadataDir, `${role}.json`), bytes);
  }
}

function fakeFetch(routes, requests) {
  return async (url) => {
    requests.push(String(url));
    if (!routes.has(String(url))) {
      return new Response('missing', { status: 404 });
    }
    const value = routes.get(String(url));
    if (value === null) return new Response('missing', { status: 404 });
    const bytes = Buffer.from(value);
    return new Response(bytes, {
      status: 200,
      headers: { 'content-length': String(bytes.length) },
    });
  };
}

function metadataRoutes(fx) {
  return new Map([
    [`${METADATA_URL}2.root.json`, null],
    [`${METADATA_URL}timestamp.json`, fx.timestamp],
    [`${METADATA_URL}2.snapshot.json`, fx.snapshot],
    [`${METADATA_URL}2.targets.json`, fx.targets],
  ]);
}

test('atomicWriteFile replaces one file without leaving a same-directory temp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-atomic-'));
  const path = join(dir, 'state.json');
  await writeFile(path, 'old');

  const result = await atomicWriteFile(path, Buffer.from('new'));
  assert.equal((await readFile(path)).toString(), 'new');
  assert.equal(result.fileSynced, true);

  const names = await readdir(dir);
  assert.deepEqual(names, ['state.json']);
});

test('initClient preserves the exact trusted root bytes', async () => {
  const fx = await fixture();
  const metadataDir = join(fx.dir, 'metadata');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);

  await initClient(metadataDir, sourceRoot);
  assert.deepEqual(await readFile(join(metadataDir, 'root.json')), fx.root);
});

test('refreshClient follows TUF top-level request order and persists exact bytes', async () => {
  const fx = await fixture();
  const metadataDir = join(fx.dir, 'metadata');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);

  const requests = [];
  const result = await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: fakeFetch(metadataRoutes(fx), requests),
  });

  assert.equal(result.status, 'metadata-verified');
  assert.deepEqual(requests, [
    `${METADATA_URL}2.root.json`,
    `${METADATA_URL}timestamp.json`,
    `${METADATA_URL}2.snapshot.json`,
    `${METADATA_URL}2.targets.json`,
  ]);
  assert.deepEqual(await readFile(join(metadataDir, 'timestamp.json')), fx.timestamp);
  assert.deepEqual(await readFile(join(metadataDir, 'snapshot.json')), fx.snapshot);
  assert.deepEqual(await readFile(join(metadataDir, 'targets.json')), fx.targets);

  const loaded = await loadTrustedState(metadataDir);
  assert.deepEqual(loaded.trustedState.versions, {
    timestamp: 2,
    snapshot: 2,
    targets: 2,
  });
});

test('refreshClient stops after timestamp when repository timestamp is unchanged', async () => {
  const fx = await fixture();
  const metadataDir = join(fx.dir, 'metadata');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);

  const firstRequests = [];
  await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: fakeFetch(metadataRoutes(fx), firstRequests),
  });

  const secondRequests = [];
  const result = await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: fakeFetch(metadataRoutes(fx), secondRequests),
  });

  assert.equal(result.status, 'no-update');
  assert.deepEqual(secondRequests, [
    `${METADATA_URL}2.root.json`,
    `${METADATA_URL}timestamp.json`,
  ]);
});

test('downloadTargets verifies a consistent-snapshot target and reuses a valid cache', async () => {
  const fx = await fixture();
  const metadataDir = join(fx.dir, 'metadata');
  const targetDir = join(fx.dir, 'targets');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);

  const parsedTargets = parseTufMetadataBytes(fx.targets, undefined, 'fixture-targets');
  const targetName = 'artifacts/demo.bin';
  const descriptor = parsedTargets.signed.targets[targetName];
  const targetBytes = Buffer.from('oracle-target-v2', 'utf8');
  const remoteTarget = `${TARGET_URL}artifacts/${descriptor.hashes.sha256}.demo.bin`;

  const routes = metadataRoutes(fx);
  routes.set(remoteTarget, targetBytes);
  const requests = [];
  const fetchImpl = fakeFetch(routes, requests);

  const first = await downloadTargets({
    metadataDir,
    metadataUrl: METADATA_URL,
    targetBaseUrl: TARGET_URL,
    targetDir,
    targetNames: [targetName],
    now: NOW,
    fetchImpl,
  });
  assert.equal(first.downloaded[0].cached, false);
  assert.deepEqual(
    await readFile(join(targetDir, 'artifacts', 'demo.bin')),
    targetBytes,
  );

  const targetRequestsAfterFirst = requests.filter((url) => url === remoteTarget).length;
  assert.equal(targetRequestsAfterFirst, 1);

  const second = await downloadTargets({
    metadataDir,
    metadataUrl: METADATA_URL,
    targetBaseUrl: TARGET_URL,
    targetDir,
    targetNames: [targetName],
    now: NOW,
    fetchImpl,
  });
  assert.equal(second.downloaded[0].cached, true);
  assert.equal(requests.filter((url) => url === remoteTarget).length, 1);
});

test('downloadTargets rejects substituted target bytes before persistence', async () => {
  const fx = await fixture();
  const metadataDir = join(fx.dir, 'metadata');
  const targetDir = join(fx.dir, 'targets');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);

  const parsedTargets = parseTufMetadataBytes(fx.targets, undefined, 'fixture-targets');
  const targetName = 'artifacts/demo.bin';
  const descriptor = parsedTargets.signed.targets[targetName];
  const remoteTarget = `${TARGET_URL}artifacts/${descriptor.hashes.sha256}.demo.bin`;

  const routes = metadataRoutes(fx);
  routes.set(remoteTarget, Buffer.from('malicious-substitution', 'utf8'));

  await assert.rejects(
    downloadTargets({
      metadataDir,
      metadataUrl: METADATA_URL,
      targetBaseUrl: TARGET_URL,
      targetDir,
      targetNames: [targetName],
      now: NOW,
      fetchImpl: fakeFetch(routes, []),
    }),
    (error) => error?.code === 'TARGET_LENGTH' || error?.code === 'TARGET_HASH',
  );

  await assert.rejects(
    readFile(join(targetDir, 'artifacts', 'demo.bin')),
    (error) => error?.code === 'ENOENT',
  );
});

test('refreshClient rejects an expired timestamp served again at the trusted version', async () => {
  const fx = await fixture();
  const expired = fx.corpus.cases.find((entry) => entry.name === 'reject-expired-timestamp');
  const expiredTimestamp = decode(expired.timestamp_b64);
  assert.equal(
    parseTufMetadataBytes(expiredTimestamp).signed.version,
    parseTufMetadataBytes(fx.timestamp).signed.version,
  );
  assert.deepEqual(decode(expired.snapshot_b64), fx.snapshot);

  // State persisted while this timestamp was current; the repository (or a
  // mirror) keeps serving the very same timestamp after it expired.
  const metadataDir = join(fx.dir, 'metadata');
  await writeTrustedState(metadataDir, {
    root: fx.root,
    timestamp: expiredTimestamp,
    snapshot: fx.snapshot,
    targets: fx.targets,
  });
  const routes = metadataRoutes(fx);
  routes.set(`${METADATA_URL}timestamp.json`, expiredTimestamp);

  await assert.rejects(
    refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(routes, []),
    }),
    (error) => error?.code === 'EXPIRED_METADATA' && error?.details?.role === 'timestamp',
  );
});

test('refreshClient does not keep using expired retained targets on an unchanged timestamp', async () => {
  const fx = await fixture();
  const unchanged = rebuildChain(fx);
  assert.deepEqual(unchanged, {
    timestamp: fx.timestamp,
    snapshot: fx.snapshot,
    targets: fx.targets,
  }, 'test signer must reproduce the corpus generator bytes');

  const staleTargets = rebuildChain(fx, {
    mutateTargets(metadata) {
      metadata.signed.expires = '2026-09-01T00:00:00Z';
    },
  });
  const metadataDir = join(fx.dir, 'metadata');
  await writeTrustedState(metadataDir, { root: fx.root, ...staleTargets });
  const routes = metadataRoutes(fx);
  routes.set(`${METADATA_URL}timestamp.json`, staleTargets.timestamp);

  await assert.rejects(
    refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(routes, []),
    }),
    (error) => error?.code === 'EXPIRED_METADATA' && error?.details?.role === 'targets',
  );
});

test('initClient refuses a metadata directory that already holds trusted state', async () => {
  const fx = await fixture();
  const metadataDir = join(fx.dir, 'metadata');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);
  await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: fakeFetch(metadataRoutes(fx), []),
  });
  const before = {};
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    before[role] = await readFile(join(metadataDir, `${role}.json`));
  }

  // A root from another trust domain must not be spliced under the old
  // timestamp/snapshot/targets and their rollback versions.
  const otherRoot = join(fx.dir, 'other-root.json');
  await writeFile(otherRoot, Buffer.from(fx.root.toString('utf8').replace('"version": 1', '"version": 7')));
  await assert.rejects(
    initClient(metadataDir, otherRoot),
    (error) => error?.code === 'METADATA_DIR_INITIALIZED'
      && error.details.present.length === 4,
  );
  for (const [role, bytes] of Object.entries(before)) {
    assert.deepEqual(await readFile(join(metadataDir, `${role}.json`)), bytes, `${role}.json changed`);
  }
});

test('downloadTargets honours raised target-path limits end to end', async () => {
  const fx = await fixture();
  const limits = { ...DEFAULT_LIMITS, targetPathComponents: 128 };
  const components = DEFAULT_LIMITS.targetPathComponents + 6;
  const targetName = `${Array.from({ length: components - 1 }, () => 'd').join('/')}/demo.bin`;
  const targetBytes = Buffer.from('deep-target', 'utf8');
  const chain = rebuildChain(fx, {
    mutateTargets(metadata) {
      metadata.signed.targets = {
        [targetName]: {
          length: targetBytes.length,
          hashes: { sha256: sha256(targetBytes) },
        },
      };
    },
  });

  const metadataDir = join(fx.dir, 'metadata');
  const targetDir = join(fx.dir, 'targets');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);

  const remoteParts = targetName.split('/');
  remoteParts[remoteParts.length - 1] = `${sha256(targetBytes)}.demo.bin`;
  const routes = new Map([
    [`${METADATA_URL}2.root.json`, null],
    [`${METADATA_URL}timestamp.json`, chain.timestamp],
    [`${METADATA_URL}2.snapshot.json`, chain.snapshot],
    [`${METADATA_URL}2.targets.json`, chain.targets],
    [`${TARGET_URL}${remoteParts.join('/')}`, targetBytes],
  ]);

  let result;
  await assert.doesNotReject(async () => {
    result = await downloadTargets({
      metadataDir,
      metadataUrl: METADATA_URL,
      targetBaseUrl: TARGET_URL,
      targetDir,
      targetNames: [targetName],
      now: NOW,
      limits,
      fetchImpl: fakeFetch(routes, []),
    });
  }, 'a signed target within the configured path limits must download');
  assert.equal(result.downloaded[0].cached, false);
  assert.deepEqual(await readFile(join(targetDir, ...targetName.split('/'))), targetBytes);
});

test('atomicWriteFile fsyncs every directory entry that recursive mkdir created', async () => {
  const base = await mkdtemp(join(tmpdir(), 'browser-tuf-durable-'));
  const path = join(base, 'a', 'b', 'c', 'state.json');

  const created = await atomicWriteFile(path, Buffer.from('first'));
  assert.ok(Array.isArray(created.directorySyncs), 'directory syncs must be reported');
  assert.deepEqual(
    created.directorySyncs.map((entry) => entry.path),
    [
      join(base, 'a', 'b'),
      join(base, 'a'),
      base,
      join(base, 'a', 'b', 'c'),
    ],
  );
  assert.equal(
    created.directorySynced,
    created.directorySyncs.every((entry) => entry.synced),
  );

  const replaced = await atomicWriteFile(path, Buffer.from('second'));
  assert.deepEqual(
    replaced.directorySyncs.map((entry) => entry.path),
    [join(base, 'a', 'b', 'c')],
  );
  assert.equal((await readFile(path)).toString(), 'second');
});

// Simulated crash inside the real write sequence: the first `completed` atomic
// replacements (rename) succeed, every later one throws, as if the process had
// died right after file N was durably in place. Patches the builtin fs/promises
// binding that client-core imports, and always restores it.
async function crashAfterWrites(completed, action) {
  const original = fsPromises.rename;
  let renames = 0;
  fsPromises.rename = async (...args) => {
    renames += 1;
    if (renames > completed) {
      throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
    }
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    return await action();
  } finally {
    fsPromises.rename = original;
    syncBuiltinESMExports();
  }
}

const isSimulatedCrash = (error) => error?.code === 'SIMULATED_CRASH';

async function readRoleFiles(metadataDir) {
  const files = {};
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    try {
      files[role] = await readFile(join(metadataDir, `${role}.json`));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      files[role] = null;
    }
  }
  return files;
}

test('refresh resumes after a crash between role files of one update (C1)', async () => {
  const fx = await fixture();
  const v3 = rebuildChain(fx, {
    mutateTargets(metadata) { metadata.signed.version = 3; },
    mutateSnapshot(metadata) { metadata.signed.version = 3; },
    mutateTimestamp(metadata) { metadata.signed.version = 3; },
  });
  const v3Routes = () => new Map([
    [`${METADATA_URL}2.root.json`, null],
    [`${METADATA_URL}timestamp.json`, v3.timestamp],
    [`${METADATA_URL}3.snapshot.json`, v3.snapshot],
    [`${METADATA_URL}3.targets.json`, v3.targets],
  ]);

  // completed = 1: timestamp.json v3 written, snapshot.json still v2.
  // completed = 2: timestamp.json and snapshot.json v3, targets.json still v2.
  for (const completed of [1, 2]) {
    const metadataDir = join(fx.dir, `metadata-c1-${completed}`);
    const sourceRoot = join(fx.dir, 'source-root.json');
    await writeFile(sourceRoot, fx.root);
    await initClient(metadataDir, sourceRoot);
    await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(metadataRoutes(fx), []),
    });

    await assert.rejects(crashAfterWrites(completed, () => refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(v3Routes(), []),
    })), isSimulatedCrash);
    const crashed = await readRoleFiles(metadataDir);
    assert.deepEqual(crashed.timestamp, v3.timestamp, `crash point ${completed}`);
    assert.deepEqual(crashed.snapshot, completed >= 2 ? v3.snapshot : fx.snapshot);
    assert.deepEqual(crashed.targets, fx.targets);

    const requests = [];
    let resumed;
    await assert.doesNotReject(async () => {
      resumed = await refreshClient({
        metadataDir,
        metadataUrl: METADATA_URL,
        now: NOW,
        fetchImpl: fakeFetch(v3Routes(), requests),
      });
    }, `crash point ${completed}: refresh must resume, not wait for a newer timestamp`);
    assert.equal(resumed.status, 'metadata-verified', `crash point ${completed}`);
    assert.equal(resumed.resumedFromTrustedTimestamp, true);
    assert.deepEqual(requests, [
      `${METADATA_URL}2.root.json`,
      `${METADATA_URL}timestamp.json`,
      `${METADATA_URL}3.snapshot.json`,
      `${METADATA_URL}3.targets.json`,
    ]);
    assert.deepEqual(await readRoleFiles(metadataDir), {
      root: fx.root,
      timestamp: v3.timestamp,
      snapshot: v3.snapshot,
      targets: v3.targets,
    });

    // Healed: the next refresh is an ordinary two-request no-update.
    const quietRequests = [];
    const quiet = await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(v3Routes(), quietRequests),
    });
    assert.equal(quiet.status, 'no-update');
    assert.equal(quiet.resumedFromTrustedTimestamp, undefined);
    assert.equal(quietRequests.length, 2);
  }
});

test('resume after a crash still fails closed on files the trusted timestamp does not pin', async () => {
  const fx = await fixture();
  const v3 = rebuildChain(fx, {
    mutateTargets(metadata) { metadata.signed.version = 3; },
    mutateSnapshot(metadata) { metadata.signed.version = 3; },
    mutateTimestamp(metadata) { metadata.signed.version = 3; },
  });
  // Same version 3, validly signed, but not the snapshot that timestamp v3 pins.
  const other = rebuildChain(fx, {
    mutateTargets(metadata) { metadata.signed.version = 3; },
    mutateSnapshot(metadata) {
      metadata.signed.version = 3;
      metadata.signed.expires = '2027-01-01T00:00:00Z';
    },
    mutateTimestamp(metadata) { metadata.signed.version = 3; },
  });
  assert.notDeepEqual(other.snapshot, v3.snapshot);
  const routes = (snapshot) => new Map([
    [`${METADATA_URL}2.root.json`, null],
    [`${METADATA_URL}timestamp.json`, v3.timestamp],
    [`${METADATA_URL}3.snapshot.json`, snapshot],
    [`${METADATA_URL}3.targets.json`, v3.targets],
  ]);

  const metadataDir = join(fx.dir, 'metadata');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);
  await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: fakeFetch(metadataRoutes(fx), []),
  });
  await assert.rejects(crashAfterWrites(1, () => refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: fakeFetch(routes(v3.snapshot), []),
  })), isSimulatedCrash);
  const crashed = await readRoleFiles(metadataDir);

  await assert.rejects(
    refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(routes(other.snapshot), []),
    }),
    (error) => error?.code === 'METADATA_LENGTH' || error?.code === 'METADATA_HASH',
  );
  assert.deepEqual(await readRoleFiles(metadataDir), crashed, 'a failed resume must not write');
});

test('a crash after root.json keeps the TUF 5.3.11 rotation reset (C2)', async () => {
  const fx = await fixture();
  const rotation = fx.corpus.cases.find(
    (entry) => entry.name === 'accept-root-rotation-old-and-new-threshold',
  );
  assert.ok(rotation, 'rotation fixture missing');
  const rotatedRoot = decode(rotation.roots_b64[0]);
  const rotated = {
    timestamp: decode(rotation.timestamp_b64),
    snapshot: decode(rotation.snapshot_b64),
    targets: decode(rotation.targets_b64),
  };
  // Fast-forward attack state: an old-key timestamp at version 1000 is trusted.
  const fastForward = rebuildChain(fx, {
    mutateTimestamp(metadata) { metadata.signed.version = 1000; },
  });
  const recoveryRoutes = () => new Map([
    [`${METADATA_URL}2.root.json`, rotatedRoot],
    [`${METADATA_URL}3.root.json`, null],
    [`${METADATA_URL}timestamp.json`, rotated.timestamp],
    [`${METADATA_URL}2.snapshot.json`, rotated.snapshot],
    [`${METADATA_URL}2.targets.json`, rotated.targets],
  ]);

  async function fastForwardedClient(name) {
    const metadataDir = join(fx.dir, name);
    const sourceRoot = join(fx.dir, 'source-root.json');
    await writeFile(sourceRoot, fx.root);
    await initClient(metadataDir, sourceRoot);
    const routes = metadataRoutes(fx);
    routes.set(`${METADATA_URL}timestamp.json`, fastForward.timestamp);
    await refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(routes, []),
    });
    assert.equal((await loadTrustedState(metadataDir)).trustedState.versions.timestamp, 1000);
    return metadataDir;
  }

  // Control: the uninterrupted rotation resets the floor within one refresh.
  const controlDir = await fastForwardedClient('metadata-c2-control');
  const control = await refreshClient({
    metadataDir: controlDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: fakeFetch(recoveryRoutes(), []),
  });
  assert.equal(control.status, 'metadata-verified');
  assert.equal(control.metadataRollbackStateReset, true);

  // completed = 1: only root.json v2; completed = 2: plus new-key timestamp.json.
  for (const completed of [1, 2]) {
    const metadataDir = await fastForwardedClient(`metadata-c2-${completed}`);
    await assert.rejects(crashAfterWrites(completed, () => refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(recoveryRoutes(), []),
    })), isSimulatedCrash);
    const crashed = await readRoleFiles(metadataDir);
    assert.deepEqual(crashed.root, rotatedRoot, `crash point ${completed}`);
    assert.deepEqual(
      crashed.timestamp,
      completed >= 2 ? rotated.timestamp : fastForward.timestamp,
    );

    const loaded = await loadTrustedState(metadataDir);
    assert.deepEqual(loaded.rollbackStateReset, {
      rotatedOut: completed >= 2 ? ['snapshot'] : ['timestamp', 'snapshot'],
    });
    assert.equal(loaded.trustedState.versions.timestamp, 0);
    assert.equal(loaded.trustedState.versions.snapshot, 0);
    assert.equal(loaded.trustedState.versions.targets, 2, 'targets floor is never reset');

    let recovered;
    await assert.doesNotReject(async () => {
      recovered = await refreshClient({
        metadataDir,
        metadataUrl: METADATA_URL,
        now: NOW,
        fetchImpl: fakeFetch(recoveryRoutes(), []),
      });
    }, `crash point ${completed}: the rotation reset must survive the crash`);
    assert.equal(recovered.status, 'metadata-verified', `crash point ${completed}`);
    assert.deepEqual(await readRoleFiles(metadataDir), { root: rotatedRoot, ...rotated });
    assert.equal((await loadTrustedState(metadataDir)).rollbackStateReset, null);
  }
});

test('after a rotation reset, the old-key chain served again is still refused', async () => {
  const fx = await fixture();
  const rotation = fx.corpus.cases.find(
    (entry) => entry.name === 'accept-root-rotation-old-and-new-threshold',
  );
  const rotatedRoot = decode(rotation.roots_b64[0]);
  const metadataDir = join(fx.dir, 'metadata');
  await writeTrustedState(metadataDir, {
    root: rotatedRoot,
    timestamp: fx.timestamp,
    snapshot: fx.snapshot,
    targets: fx.targets,
  });
  // The repository (or an attacker) serves the OLD-key chain again: it must not
  // verify under the rotated root even though the local floors were reset.
  const routes = metadataRoutes(fx);
  routes.set(`${METADATA_URL}2.root.json`, null);
  routes.set(`${METADATA_URL}3.root.json`, null);
  await assert.rejects(
    refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: fakeFetch(routes, []),
    }),
    (error) => error?.code === 'SIGNATURE_THRESHOLD' && error?.details?.role === 'timestamp',
  );
});

test('init refuses anything but a self-signed TUF root and writes nothing', async () => {
  const fx = await fixture();
  const unsignedRoot = parseTufMetadataBytes(fx.root);
  unsignedRoot.signatures = [];
  const tamperedRoot = parseTufMetadataBytes(fx.root);
  tamperedRoot.signed.version = 7;
  const cases = [
    ['not-json', Buffer.from('this is not a TUF root\n', 'utf8')],
    ['empty-object', Buffer.from('{}\n', 'utf8')],
    ['targets-not-root', fx.targets],
    ['unsigned-root', Buffer.from(`${JSON.stringify(unsignedRoot, null, 2)}\n`, 'utf8')],
    ['tampered-root', Buffer.from(`${JSON.stringify(tamperedRoot, null, 2)}\n`, 'utf8')],
  ];
  const expectedCodes = {
    'empty-object': 'INVALID_METADATA',
    'targets-not-root': 'ROLE_MISMATCH',
    'unsigned-root': 'SIGNATURE_THRESHOLD',
    'tampered-root': 'SIGNATURE_THRESHOLD',
  };

  for (const [name, bytes] of cases) {
    const sourceRoot = join(fx.dir, `${name}.json`);
    await writeFile(sourceRoot, bytes);
    const metadataDir = join(fx.dir, `metadata-${name}`);
    await assert.rejects(initClient(metadataDir, sourceRoot), (error) => {
      assert.equal(typeof error?.code, 'string', name);
      if (expectedCodes[name]) assert.equal(error.code, expectedCodes[name], name);
      return true;
    });
    await assert.rejects(
      readFile(join(metadataDir, 'root.json')),
      (error) => error?.code === 'ENOENT',
      `${name}: root.json was written`,
    );
  }

  // Same through the CLI: non-zero exit, error code on stderr, nothing written.
  const sourceRoot = join(fx.dir, 'not-json.json');
  const metadataDir = join(fx.dir, 'metadata-cli');
  const cli = spawnSync(process.execPath, [CLI, 'init', sourceRoot, '--metadata-dir', metadataDir], {
    encoding: 'utf8',
  });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /tuf-client-cli \[[A-Z_]+\]/);
  await assert.rejects(
    readFile(join(metadataDir, 'root.json')),
    (error) => error?.code === 'ENOENT',
  );

  // Positive control: the genuine corpus root is accepted by the same path.
  const goodDir = join(fx.dir, 'metadata-good');
  const goodRoot = join(fx.dir, 'good-root.json');
  await writeFile(goodRoot, fx.root);
  const ok = spawnSync(process.execPath, [CLI, 'init', goodRoot, '--metadata-dir', goodDir], {
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(await readFile(join(goodDir, 'root.json')), fx.root);
});

test('refresh refuses snapshot.json without timestamp.json and targets.json without snapshot.json', async () => {
  const fx = await fixture();
  const layouts = [
    ['snapshot-without-timestamp', { root: fx.root, snapshot: fx.snapshot, targets: fx.targets }],
    ['targets-without-snapshot', { root: fx.root, timestamp: fx.timestamp, targets: fx.targets }],
  ];
  for (const [name, files] of layouts) {
    const metadataDir = join(fx.dir, name);
    await writeTrustedState(metadataDir, files);
    const requests = [];
    await assert.rejects(
      refreshClient({
        metadataDir,
        metadataUrl: METADATA_URL,
        now: NOW,
        fetchImpl: fakeFetch(metadataRoutes(fx), requests),
      }),
      (error) => error?.code === 'INCOMPLETE_LOCAL_STATE',
      name,
    );
    assert.deepEqual(requests, [], `${name}: no request before the local-state check`);
  }
});

test('fetchBounded enforces the byte ceiling on a stream without Content-Length', async () => {
  const chunk = new Uint8Array(1024).fill(0x61);
  const streamOf = (chunks) => {
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        if (sent === chunks) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    return { body, state: () => ({ sent, cancelled }) };
  };

  const oversized = streamOf(8);
  const response = new Response(oversized.body, { status: 200 });
  assert.equal(response.headers.get('content-length'), null);
  await assert.rejects(
    fetchBounded('https://repo.test/stream', {
      maxBytes: 5000,
      fetchImpl: async () => response,
    }),
    (error) => error?.code === 'DOWNLOAD_TOO_LARGE',
  );
  assert.ok(oversized.state().sent < 8, 'the stream was read past the ceiling');
  assert.equal(oversized.state().cancelled, true);

  // Positive control: the same stream at an exactly sufficient ceiling.
  const exact = streamOf(8);
  const bytes = await fetchBounded('https://repo.test/stream', {
    maxBytes: 8 * 1024,
    fetchImpl: async () => new Response(exact.body, { status: 200 }),
  });
  assert.equal(bytes.length, 8 * 1024);
});

test('fetchBounded refuses an HTTP redirect instead of following it', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/metadata/timestamp.json') {
      response.writeHead(302, { location: '/elsewhere/timestamp.json' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end('redirected-content');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    // Positive control: the redirect target itself is reachable.
    assert.equal(
      (await fetchBounded(`${base}/elsewhere/timestamp.json`, { maxBytes: 1024 })).toString(),
      'redirected-content',
    );
    await assert.rejects(
      fetchBounded(`${base}/metadata/timestamp.json`, { maxBytes: 1024 }),
      (error) => error instanceof TypeError,
    );
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
