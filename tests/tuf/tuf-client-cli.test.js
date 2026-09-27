import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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
    root: decode(item.trusted_root_b64),
    timestamp: decode(item.timestamp_b64),
    snapshot: decode(item.snapshot_b64),
    targets: decode(item.targets_b64),
  };
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
