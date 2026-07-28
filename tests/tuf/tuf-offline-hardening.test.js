import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
} from 'node:crypto';
import test from 'node:test';

import {
  canonicalBytes,
  canonicalJson,
  keyIdFor,
  POUF,
  sha256,
  TufSpikeError,
  verifyOfflineBundle,
} from '../../spike/tuf-offline-metadata/tuf-offline.js';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const FUTURE = '2027-07-28T12:00:00.000Z';
const TARGET_PATH = 'apps/demo.cwap';
const TARGET_BYTES = Buffer.from('browser-offline-package-v2', 'utf8');
const PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function material(name) {
  const seed = Buffer.from(sha256(`browser-tuf-hardening:${name}`), 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const key = {
    keytype: 'ed25519',
    scheme: 'ed25519',
    keyval: { public: publicDer.subarray(-32).toString('hex') },
  };
  return { privateKey, key, keyId: keyIdFor(key) };
}

const KEY = Object.freeze({
  root: material('root'),
  timestamp: material('timestamp'),
  snapshotA: material('snapshot-a'),
  snapshotB: material('snapshot-b'),
  targets: material('targets'),
});

function envelope(signed, signers) {
  return {
    signatures: signers.map((signer) => ({
      keyid: signer.keyId,
      sig: signBytes(null, canonicalBytes(signed), signer.privateKey).toString('hex'),
    })),
    signed,
  };
}

function descriptor(metadata, version = metadata.signed.version) {
  const bytes = canonicalBytes(metadata);
  return { version, length: bytes.length, hashes: { sha256: sha256(bytes) } };
}

function rootMetadata({ version = 1, snapshot = KEY.snapshotA } = {}) {
  const keys = Object.fromEntries(
    [KEY.root, KEY.timestamp, snapshot, KEY.targets].map((entry) => [entry.keyId, entry.key]),
  );
  return envelope({
    _type: 'root',
    spec_version: POUF.specVersion,
    version,
    expires: FUTURE,
    consistent_snapshot: true,
    keys,
    roles: {
      root: { keyids: [KEY.root.keyId], threshold: 1 },
      timestamp: { keyids: [KEY.timestamp.keyId], threshold: 1 },
      snapshot: { keyids: [snapshot.keyId], threshold: 1 },
      targets: { keyids: [KEY.targets.keyId], threshold: 1 },
    },
  }, [KEY.root]);
}

function bundle({
  roots = [],
  snapshotSigner = KEY.snapshotA,
  timestampVersion = 2,
  snapshotVersion = 2,
  targetsVersion = 2,
  appVersion = 2,
  capabilities = ['storage.read'],
  extraTargets = {},
  timestampExpires = FUTURE,
} = {}) {
  const targets = envelope({
    _type: 'targets',
    spec_version: POUF.specVersion,
    version: targetsVersion,
    expires: FUTURE,
    targets: {
      [TARGET_PATH]: {
        length: TARGET_BYTES.length,
        hashes: { sha256: sha256(TARGET_BYTES) },
        custom: {
          app_id: 'demo.app',
          app_version: appVersion,
          capabilities,
        },
      },
      ...extraTargets,
    },
  }, [KEY.targets]);

  const snapshot = envelope({
    _type: 'snapshot',
    spec_version: POUF.specVersion,
    version: snapshotVersion,
    expires: FUTURE,
    meta: { 'targets.json': descriptor(targets) },
  }, [snapshotSigner]);

  const timestamp = envelope({
    _type: 'timestamp',
    spec_version: POUF.specVersion,
    version: timestampVersion,
    expires: timestampExpires,
    meta: { 'snapshot.json': descriptor(snapshot) },
  }, [KEY.timestamp]);

  return {
    roots,
    timestamp,
    snapshot,
    targets,
    target: { path: TARGET_PATH, bytes: Buffer.from(TARGET_BYTES) },
  };
}

function state(root = rootMetadata()) {
  return {
    root,
    versions: { timestamp: 1, snapshot: 1, targets: 1 },
    snapshotMeta: { 'targets.json': { version: 1 } },
    app: {
      appId: 'demo.app',
      version: 1,
      capabilities: ['storage.read'],
      targetPath: TARGET_PATH,
      digest: sha256(Buffer.from('browser-offline-package-v1', 'utf8')),
    },
  };
}

function expectCode(code, action) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof TufSpikeError);
    assert.equal(error.code, code);
    return true;
  });
}

test('snapshot-key rotation resets timestamp and snapshot fast-forward state', () => {
  const oldRoot = rootMetadata();
  const newRoot = rootMetadata({ version: 2, snapshot: KEY.snapshotB });
  const trusted = state(oldRoot);
  trusted.versions.timestamp = 99;
  trusted.versions.snapshot = 99;
  trusted.snapshotMeta['targets.json'].version = 99;

  const result = verifyOfflineBundle({
    trustedState: trusted,
    bundle: bundle({
      roots: [newRoot],
      snapshotSigner: KEY.snapshotB,
      timestampVersion: 1,
      snapshotVersion: 1,
      targetsVersion: 2,
    }),
    targetPath: TARGET_PATH,
    now: NOW,
  });

  assert.equal(result.status, 'update-verified');
  assert.equal(result.nextState.versions.timestamp, 1);
  assert.equal(result.nextState.versions.snapshot, 1);
});

test('snapshot-key rotation never resets the separately trusted targets version', () => {
  const oldRoot = rootMetadata();
  const newRoot = rootMetadata({ version: 2, snapshot: KEY.snapshotB });
  const trusted = state(oldRoot);
  trusted.versions.timestamp = 99;
  trusted.versions.snapshot = 99;
  trusted.versions.targets = 3;
  trusted.snapshotMeta['targets.json'].version = 99;

  expectCode('TARGETS_ROLLBACK', () => verifyOfflineBundle({
    trustedState: trusted,
    bundle: bundle({
      roots: [newRoot],
      snapshotSigner: KEY.snapshotB,
      timestampVersion: 1,
      snapshotVersion: 1,
      targetsVersion: 2,
    }),
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('an app version cannot be reused with different capabilities', () => {
  const trusted = state();
  trusted.app.digest = sha256(TARGET_BYTES);

  expectCode('APP_VERSION_REUSE', () => verifyOfflineBundle({
    trustedState: trusted,
    bundle: bundle({
      appVersion: 1,
      capabilities: ['storage.read', 'network.client'],
    }),
    targetPath: TARGET_PATH,
    now: NOW,
    approveCapabilityExpansion: () => true,
  }));
});

test('every signed target path is validated, not only the requested target', () => {
  const evilBytes = Buffer.from('evil', 'utf8');
  expectCode('INVALID_TARGET_PATH', () => verifyOfflineBundle({
    trustedState: state(),
    bundle: bundle({
      extraTargets: {
        '../evil': {
          length: evilBytes.length,
          hashes: { sha256: sha256(evilBytes) },
          custom: {
            app_id: 'evil.app',
            app_version: 1,
            capabilities: [],
          },
        },
      },
    }),
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('canonical JSON rejects excessive depth and cycles before stack exhaustion', () => {
  const deep = { value: 0 };
  let cursor = deep;
  for (let index = 0; index < 8; index += 1) {
    cursor.next = { value: index };
    cursor = cursor.next;
  }

  expectCode('JSON_DEPTH_LIMIT', () => canonicalJson(deep, '$', {
    jsonDepth: 4,
    jsonNodes: 100,
  }));

  const cyclic = {};
  cyclic.self = cyclic;
  expectCode('CYCLIC_JSON', () => canonicalJson(cyclic));
});

test('noncanonical expiry encodings are rejected by the pinned POUF', () => {
  expectCode('INVALID_EXPIRY', () => verifyOfflineBundle({
    trustedState: state(),
    bundle: bundle({ timestampExpires: '2027-07-28T14:00:00+02:00' }),
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});
