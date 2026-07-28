import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
} from 'node:crypto';
import test from 'node:test';

import {
  canonicalBytes,
  keyIdFor,
  POUF,
  sha256,
  TufSpikeError,
  updateRootChain,
  verifyOfflineBundle,
} from '../../spike/tuf-offline-metadata/tuf-offline.js';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const FUTURE = '2027-07-28T12:00:00.000Z';
const PAST = '2026-07-27T12:00:00.000Z';
const TARGET_PATH = 'apps/demo.cwap';

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const KEY_NAMES = Object.freeze([
  'rootA',
  'rootB',
  'rootC',
  'timestampA',
  'timestampB',
  'snapshotA',
  'snapshotB',
  'targetsA',
]);

function deterministicKeyMaterial(name) {
  const seed = Buffer.from(sha256(`browser-tuf-spike-test-key:${name}`), 'hex');
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return { privateKey, public: publicDer.subarray(-32).toString('hex') };
}

const MATERIAL = Object.freeze(Object.fromEntries(
  KEY_NAMES.map((name) => [name, deterministicKeyMaterial(name)]),
));

function tufKey(name) {
  return {
    keytype: 'ed25519',
    scheme: 'ed25519',
    keyval: { public: MATERIAL[name].public },
  };
}

const KEYS = Object.freeze(Object.fromEntries(
  Object.keys(MATERIAL).map((name) => [name, {
    key: tufKey(name),
    keyId: keyIdFor(tufKey(name)),
    privateKey: MATERIAL[name].privateKey,
  }]),
));

function signatureFor(signed, signerName) {
  return {
    keyid: KEYS[signerName].keyId,
    sig: signBytes(null, canonicalBytes(signed), KEYS[signerName].privateKey).toString('hex'),
  };
}

function signedMetadata(signed, signerNames) {
  return {
    signatures: signerNames.map((name) => signatureFor(signed, name)),
    signed,
  };
}

function metadataDescriptor(metadata, version = metadata.signed.version) {
  const bytes = canonicalBytes(metadata);
  return {
    version,
    length: bytes.length,
    hashes: { sha256: sha256(bytes) },
  };
}

function rootMetadata({
  version = 1,
  rootNames = ['rootA', 'rootB'],
  timestampName = 'timestampA',
  snapshotName = 'snapshotA',
  signerNames = rootNames,
} = {}) {
  const names = [...new Set([...rootNames, timestampName, snapshotName, 'targetsA'])];
  const keys = Object.fromEntries(names.map((name) => [KEYS[name].keyId, KEYS[name].key]));
  const signed = {
    _type: 'root',
    spec_version: POUF.specVersion,
    version,
    expires: FUTURE,
    consistent_snapshot: true,
    keys,
    roles: {
      root: { keyids: rootNames.map((name) => KEYS[name].keyId), threshold: 2 },
      timestamp: { keyids: [KEYS[timestampName].keyId], threshold: 1 },
      snapshot: { keyids: [KEYS[snapshotName].keyId], threshold: 1 },
      targets: { keyids: [KEYS.targetsA.keyId], threshold: 1 },
    },
  };
  return signedMetadata(signed, signerNames);
}

function updateBundle({
  root = rootMetadata(),
  roots = [],
  timestampVersion = 2,
  snapshotVersion = 2,
  targetsVersion = 2,
  appVersion = 2,
  capabilities = ['storage.read'],
  targetBytes = Buffer.from('browser-offline-package-v2', 'utf8'),
  timestampSigner = 'timestampA',
  snapshotSigner = 'snapshotA',
  timestampExpires = FUTURE,
  snapshotExpires = FUTURE,
  targetsExpires = FUTURE,
} = {}) {
  const targetsSigned = {
    _type: 'targets',
    spec_version: POUF.specVersion,
    version: targetsVersion,
    expires: targetsExpires,
    targets: {
      [TARGET_PATH]: {
        length: targetBytes.length,
        hashes: { sha256: sha256(targetBytes) },
        custom: {
          app_id: 'demo.app',
          app_version: appVersion,
          capabilities,
        },
      },
    },
  };
  const targets = signedMetadata(targetsSigned, ['targetsA']);

  const snapshotSigned = {
    _type: 'snapshot',
    spec_version: POUF.specVersion,
    version: snapshotVersion,
    expires: snapshotExpires,
    meta: {
      'targets.json': metadataDescriptor(targets),
    },
  };
  const snapshot = signedMetadata(snapshotSigned, [snapshotSigner]);

  const timestampSigned = {
    _type: 'timestamp',
    spec_version: POUF.specVersion,
    version: timestampVersion,
    expires: timestampExpires,
    meta: {
      'snapshot.json': metadataDescriptor(snapshot),
    },
  };
  const timestamp = signedMetadata(timestampSigned, [timestampSigner]);

  return {
    roots,
    timestamp,
    snapshot,
    targets,
    target: { path: TARGET_PATH, bytes: Buffer.from(targetBytes) },
    root,
  };
}

function trustedState(root = rootMetadata()) {
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

function cloneBundle(bundle) {
  return {
    roots: bundle.roots.map((root) => structuredClone(root)),
    timestamp: structuredClone(bundle.timestamp),
    snapshot: structuredClone(bundle.snapshot),
    targets: structuredClone(bundle.targets),
    target: { path: bundle.target.path, bytes: Buffer.from(bundle.target.bytes) },
  };
}

function resign(metadata, signerNames) {
  metadata.signatures = signerNames.map((name) => signatureFor(metadata.signed, name));
}

function assertCode(expectedCode, action) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof TufSpikeError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('verifies a complete offline update and returns a proposed atomic next state', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root });
  const result = verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  });

  assert.equal(result.status, 'update-verified');
  assert.equal(result.persistenceRequired, true);
  assert.equal(result.nextState.versions.timestamp, 2);
  assert.equal(result.nextState.versions.snapshot, 2);
  assert.equal(result.nextState.versions.targets, 2);
  assert.equal(result.nextState.app.version, 2);
  assert.deepEqual(result.nextState.app.capabilities, ['storage.read']);
  assert.deepEqual(result.target, bundle.target.bytes);
});

test('treats the same trusted timestamp version as a normal no-update result', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root, timestampVersion: 1 });
  const result = verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  });

  assert.equal(result.status, 'no-update');
});

test('rejects duplicate signature key ids instead of counting them twice', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root });
  bundle.timestamp.signatures = [
    bundle.timestamp.signatures[0],
    structuredClone(bundle.timestamp.signatures[0]),
  ];

  assertCode('DUPLICATE_SIGNATURE', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('root rotation requires the old and new root thresholds', () => {
  const oldRoot = rootMetadata();
  const candidate = rootMetadata({
    version: 2,
    rootNames: ['rootB', 'rootC'],
    signerNames: ['rootA', 'rootB'],
  });

  assertCode('SIGNATURE_THRESHOLD', () => updateRootChain(oldRoot, [candidate], NOW));
});

test('valid dual-threshold root rotation resets timestamp and snapshot rollback state', () => {
  const oldRoot = rootMetadata();
  const nextRoot = rootMetadata({
    version: 2,
    rootNames: ['rootB', 'rootC'],
    timestampName: 'timestampB',
    snapshotName: 'snapshotB',
    signerNames: ['rootA', 'rootB', 'rootC'],
  });
  const bundle = updateBundle({
    root: oldRoot,
    roots: [nextRoot],
    timestampVersion: 1,
    snapshotVersion: 1,
    targetsVersion: 2,
    timestampSigner: 'timestampB',
    snapshotSigner: 'snapshotB',
  });
  const state = trustedState(oldRoot);
  state.versions.timestamp = 99;
  state.versions.snapshot = 99;
  state.snapshotMeta['targets.json'].version = 99;

  const result = verifyOfflineBundle({
    trustedState: state,
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  });

  assert.equal(result.status, 'update-verified');
  assert.equal(result.nextState.root.signed.version, 2);
  assert.equal(result.nextState.versions.timestamp, 1);
  assert.equal(result.nextState.versions.snapshot, 1);
});

test('rejects mix-and-match snapshot bytes before trusting snapshot signatures', () => {
  const root = rootMetadata();
  const bundle = cloneBundle(updateBundle({ root }));
  bundle.snapshot.signed.expires = '2028-01-01T00:00:00.000Z';
  resign(bundle.snapshot, ['snapshotA']);

  assertCode('METADATA_HASH', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects snapshot version disagreement with timestamp metadata', () => {
  const root = rootMetadata();
  const bundle = cloneBundle(updateBundle({ root }));
  bundle.snapshot.signed.version = 3;
  resign(bundle.snapshot, ['snapshotA']);
  bundle.timestamp.signed.meta['snapshot.json'] = metadataDescriptor(bundle.snapshot, 2);
  resign(bundle.timestamp, ['timestampA']);

  assertCode('SNAPSHOT_VERSION', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects timestamp rollback', () => {
  const root = rootMetadata();
  const state = trustedState(root);
  state.versions.timestamp = 3;

  assertCode('TIMESTAMP_ROLLBACK', () => verifyOfflineBundle({
    trustedState: state,
    bundle: updateBundle({ root, timestampVersion: 2 }),
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects expired timestamp metadata as a freeze signal', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root, timestampExpires: PAST });

  assertCode('EXPIRED_METADATA', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects target bytes that do not match signed target metadata', () => {
  const root = rootMetadata();
  const bundle = cloneBundle(updateBundle({ root }));
  bundle.target.bytes = Buffer.from('browser-offline-package-X2', 'utf8');

  assertCode('TARGET_HASH', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects rollback of targets metadata recorded in trusted snapshot state', () => {
  const root = rootMetadata();
  const state = trustedState(root);
  state.snapshotMeta['targets.json'].version = 3;

  assertCode('TARGETS_ROLLBACK', () => verifyOfflineBundle({
    trustedState: state,
    bundle: updateBundle({ root, targetsVersion: 2 }),
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects capability expansion without explicit re-consent', () => {
  const root = rootMetadata();
  const bundle = updateBundle({
    root,
    capabilities: ['storage.read', 'network.client'],
  });

  assertCode('CAPABILITY_ESCALATION', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('accepts capability expansion only when the exact expansion is approved', () => {
  const root = rootMetadata();
  const bundle = updateBundle({
    root,
    capabilities: ['storage.read', 'network.client'],
  });
  let observed;

  const result = verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
    approveCapabilityExpansion: (request) => {
      observed = request;
      return request.expansion.length === 1 && request.expansion[0] === 'network.client';
    },
  });

  assert.deepEqual(observed.expansion, ['network.client']);
  assert.deepEqual(result.nextState.app.capabilities, ['network.client', 'storage.read']);
});

test('rejects metadata above the configured pre-allocation envelope', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root });

  assertCode('METADATA_TOO_LARGE', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
    limits: {
      metadataBytes: 16,
      targetBytes: 1024,
      signatures: 8,
      rootKeys: 16,
      rootUpdates: 4,
      targetCount: 16,
      capabilities: 16,
    },
  }));
});
