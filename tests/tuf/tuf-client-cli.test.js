import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  atomicWriteFile,
  downloadTargets,
  initClient,
  loadTrustedState,
  refreshClient,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import {
  parseTufMetadataBytes,
} from '../../spike/tuf-offline-metadata/strict-json.js';
import {
  canonicalBytes,
  keyIdFor,
  sha256,
} from '../../spike/tuf-offline-metadata/tuf-offline.js';

const GENERATOR = 'spike/tuf-offline-metadata/differential/generate-corpus.mjs';
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
