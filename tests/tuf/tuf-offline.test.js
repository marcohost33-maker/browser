import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
} from 'node:crypto';
import test from 'node:test';

import {
  canonicalBytes,
  DEFAULT_LIMITS,
  keyIdFor,
  POUF,
  sha256,
  TufSpikeError,
  updateRootChain,
  verifyOfflineBundle,
  verifyTopLevelMetadata,
} from '../../spike/tuf-offline-metadata/tuf-offline.js';

import {
  parseStrictJsonBytes,
  verifyOfflineBundleBytes,
  verifyTopLevelMetadataBytes,
} from '../../spike/tuf-offline-metadata/strict-json.js';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const FUTURE = '2027-07-28T12:00:00Z';
const PAST = '2026-07-27T12:00:00Z';
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

function metadataDescriptor(
  metadata,
  version = metadata.signed.version,
  rawBytes = canonicalBytes(metadata),
) {
  const bytes = Buffer.from(rawBytes);
  return {
    version,
    length: bytes.length,
    hashes: { sha256: sha256(bytes) },
  };
}

function rawMetadataBytes(metadata) {
  return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
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

test('generic top-level verifier is independent of Browser app policy', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root });

  delete bundle.targets.signed.targets[TARGET_PATH].custom;
  resign(bundle.targets, ['targetsA']);
  bundle.snapshot.signed.meta['targets.json'] = metadataDescriptor(bundle.targets);
  resign(bundle.snapshot, ['snapshotA']);
  bundle.timestamp.signed.meta['snapshot.json'] = metadataDescriptor(bundle.snapshot);
  resign(bundle.timestamp, ['timestampA']);

  const result = verifyTopLevelMetadata({
    trustedState: trustedState(root),
    bundle,
    now: NOW,
  });

  assert.equal(result.status, 'metadata-verified');
  assert.equal(result.targetsVersion, 2);
  assert.equal(result.trustedRoot.signed.version, 1);
});

test('Browser verifier still fails closed when Browser target policy is absent', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root });

  delete bundle.targets.signed.targets[TARGET_PATH].custom;
  resign(bundle.targets, ['targetsA']);
  bundle.snapshot.signed.meta['targets.json'] = metadataDescriptor(bundle.targets);
  resign(bundle.snapshot, ['snapshotA']);
  bundle.timestamp.signed.meta['snapshot.json'] = metadataDescriptor(bundle.snapshot);
  resign(bundle.timestamp, ['timestampA']);

  assert.throws(() => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

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

test('raw ingress verifies noncanonical envelope bytes using exact file hashes', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root });

  const rawTargets = rawMetadataBytes(bundle.targets);
  bundle.snapshot.signed.meta['targets.json'] = metadataDescriptor(
    bundle.targets,
    bundle.targets.signed.version,
    rawTargets,
  );
  resign(bundle.snapshot, ['snapshotA']);

  const rawSnapshot = rawMetadataBytes(bundle.snapshot);
  bundle.timestamp.signed.meta['snapshot.json'] = metadataDescriptor(
    bundle.snapshot,
    bundle.snapshot.signed.version,
    rawSnapshot,
  );
  resign(bundle.timestamp, ['timestampA']);

  const result = verifyOfflineBundleBytes({
    trustedState: trustedState(root),
    bundle: {
      roots: [],
      timestamp: rawMetadataBytes(bundle.timestamp),
      snapshot: rawSnapshot,
      targets: rawTargets,
      target: bundle.target,
    },
    targetPath: TARGET_PATH,
    now: NOW,
  });

  assert.equal(result.status, 'update-verified');
  assert.equal(result.nextState.versions.snapshot, 2);
  assert.equal(result.nextState.versions.targets, 2);
});

test('raw ingress rejects descriptors computed over reserialized metadata', () => {
  const root = rootMetadata();
  const bundle = updateBundle({ root });

  assertCode('METADATA_LENGTH', () => verifyOfflineBundleBytes({
    trustedState: trustedState(root),
    bundle: {
      roots: [],
      timestamp: rawMetadataBytes(bundle.timestamp),
      snapshot: rawMetadataBytes(bundle.snapshot),
      targets: rawMetadataBytes(bundle.targets),
      target: bundle.target,
    },
    targetPath: TARGET_PATH,
    now: NOW,
  }));
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

test('rejects timestamp metadata that describes anything beyond snapshot.json', () => {
  const root = rootMetadata();
  const bundle = cloneBundle(updateBundle({ root }));
  bundle.timestamp.signed.meta['extra.json'] = {
    version: 1,
    length: 1,
    hashes: { sha256: '0'.repeat(64) },
  };
  resign(bundle.timestamp, ['timestampA']);

  assertCode('INVALID_TIMESTAMP_META', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects delegated snapshot entries until delegation traversal is implemented', () => {
  const root = rootMetadata();
  const bundle = cloneBundle(updateBundle({ root }));
  bundle.snapshot.signed.meta['publisher.json'] = metadataDescriptor(bundle.targets);
  resign(bundle.snapshot, ['snapshotA']);
  bundle.timestamp.signed.meta['snapshot.json'] = metadataDescriptor(bundle.snapshot);
  resign(bundle.timestamp, ['timestampA']);

  assertCode('UNSUPPORTED_SNAPSHOT_META', () => verifyOfflineBundle({
    trustedState: trustedState(root),
    bundle,
    targetPath: TARGET_PATH,
    now: NOW,
  }));
});

test('rejects mix-and-match snapshot bytes before trusting snapshot signatures', () => {
  const root = rootMetadata();
  const bundle = cloneBundle(updateBundle({ root }));
  bundle.snapshot.signed.expires = '2028-01-01T00:00:00Z';
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

test('rejects oversized raw metadata before making any defensive copy', (t) => {
  const limits = { ...DEFAULT_LIMITS, metadataBytes: 16 * 1024 };
  const oversized = new Uint8Array(limits.metadataBytes + 1);
  const root = rootMetadata();
  const bundle = updateBundle({ root });
  const bufferFrom = t.mock.method(Buffer, 'from');
  const copiedOversized = () => bufferFrom.mock.calls.some(
    (call) => call.arguments[0] === oversized,
  );

  assertCode('METADATA_TOO_LARGE', () => parseStrictJsonBytes(oversized, {
    maxBytes: limits.metadataBytes,
  }));
  assert.equal(copiedOversized(), false, 'strict parser copied before its size gate');

  assertCode('METADATA_TOO_LARGE', () => verifyOfflineBundleBytes({
    trustedState: trustedState(root),
    bundle: {
      roots: [],
      timestamp: oversized,
      snapshot: oversized,
      targets: oversized,
      target: bundle.target,
    },
    targetPath: TARGET_PATH,
    now: NOW,
    limits,
  }));
  assert.equal(copiedOversized(), false, 'raw ingress copied before its size gate');

  assertCode('METADATA_TOO_LARGE', () => verifyTopLevelMetadata({
    trustedState: trustedState(root),
    bundle: { ...bundle, rawMetadata: { timestamp: oversized } },
    now: NOW,
    limits,
  }));
  assert.equal(copiedOversized(), false, 'generic core copied before its size gate');
});

test('rejects an over-limit raw root chain before reading any candidate', () => {
  const limits = { ...DEFAULT_LIMITS, rootUpdates: 2 };
  const root = rootMetadata();
  const bundle = updateBundle({ root });
  let candidateReads = 0;
  const overLimitRoots = () => {
    const roots = [];
    for (let index = 0; index <= limits.rootUpdates; index += 1) {
      Object.defineProperty(roots, index, {
        enumerable: true,
        get() {
          candidateReads += 1;
          return rawMetadataBytes(root);
        },
      });
    }
    return roots;
  };
  const rawBundle = () => ({
    roots: overLimitRoots(),
    timestamp: rawMetadataBytes(bundle.timestamp),
    snapshot: rawMetadataBytes(bundle.snapshot),
    targets: rawMetadataBytes(bundle.targets),
    target: bundle.target,
  });

  assertCode('TOO_MANY_ROOT_UPDATES', () => verifyOfflineBundleBytes({
    trustedState: trustedState(root),
    bundle: rawBundle(),
    targetPath: TARGET_PATH,
    now: NOW,
    limits,
  }));
  assertCode('TOO_MANY_ROOT_UPDATES', () => verifyTopLevelMetadataBytes({
    trustedState: trustedState(root),
    bundle: rawBundle(),
    now: NOW,
    limits,
  }));
  assert.equal(candidateReads, 0, 'root candidates were read before the count gate');
});

test('generic core decides on the exact raw bytes its descriptors hashed', () => {
  const root = rootMetadata();
  const vouched = updateBundle({ root });
  const substitute = updateBundle({
    root,
    targetsVersion: 3,
    targetBytes: Buffer.from('substituted-package', 'utf8'),
  });
  assert.equal(substitute.snapshot.signed.version, vouched.snapshot.signed.version);

  const rawVouchedSnapshot = rawMetadataBytes(vouched.snapshot);
  vouched.timestamp.signed.meta['snapshot.json'] = metadataDescriptor(
    vouched.snapshot,
    vouched.snapshot.signed.version,
    rawVouchedSnapshot,
  );
  resign(vouched.timestamp, ['timestampA']);

  // Snapshot bytes A satisfy the timestamp hash; a different validly signed
  // snapshot B of the same version must not drive the decision.
  assertCode('RAW_METADATA_MISMATCH', () => verifyTopLevelMetadata({
    trustedState: trustedState(root),
    bundle: {
      roots: [],
      timestamp: vouched.timestamp,
      snapshot: substitute.snapshot,
      targets: substitute.targets,
      rawMetadata: { snapshot: rawVouchedSnapshot },
    },
    now: NOW,
  }));

  const bytesOnly = verifyTopLevelMetadata({
    trustedState: trustedState(root),
    bundle: {
      roots: [],
      timestamp: vouched.timestamp,
      targets: vouched.targets,
      rawMetadata: { snapshot: rawVouchedSnapshot },
    },
    now: NOW,
  });
  assert.equal(bytesOnly.status, 'metadata-verified');
  assert.equal(bytesOnly.targetsVersion, vouched.targets.signed.version);
});

function rawBoundBundle(root) {
  const bundle = updateBundle({ root });
  const rawTargets = rawMetadataBytes(bundle.targets);
  bundle.snapshot.signed.meta['targets.json'] = metadataDescriptor(
    bundle.targets,
    bundle.targets.signed.version,
    rawTargets,
  );
  resign(bundle.snapshot, ['snapshotA']);
  const rawSnapshot = rawMetadataBytes(bundle.snapshot);
  bundle.timestamp.signed.meta['snapshot.json'] = metadataDescriptor(
    bundle.snapshot,
    bundle.snapshot.signed.version,
    rawSnapshot,
  );
  resign(bundle.timestamp, ['timestampA']);
  return {
    bundle,
    raw: {
      roots: [],
      timestamp: rawMetadataBytes(bundle.timestamp),
      snapshot: rawSnapshot,
      targets: rawTargets,
    },
  };
}

test('returns exactly the target bytes it hashed, reading target.bytes once', () => {
  const root = rootMetadata();
  const { bundle, raw } = rawBoundBundle(root);
  const vouched = Buffer.from(bundle.target.bytes);
  const unvouched = Buffer.from('unvouched-payload-served-on-a-later-read', 'utf8');
  const entries = [
    ['raw ingress', (target) => verifyOfflineBundleBytes({
      trustedState: trustedState(root),
      bundle: { ...raw, target },
      targetPath: TARGET_PATH,
      now: NOW,
    })],
    ['object ingress', (target) => verifyOfflineBundle({
      trustedState: trustedState(root),
      // Object mode signs descriptors over canonical bytes, so it needs its
      // own fixture; the target bytes are the same default package.
      bundle: { ...cloneBundle(updateBundle({ root })), target },
      targetPath: TARGET_PATH,
      now: NOW,
    })],
  ];

  for (const [label, verify] of entries) {
    // Accessor: the first read serves the vouched bytes, every later read other
    // bytes. Only one read may happen, and the result must be the hashed bytes.
    let reads = 0;
    const accessorTarget = {
      path: TARGET_PATH,
      get bytes() {
        reads += 1;
        return reads === 1 ? vouched : unvouched;
      },
    };
    const viaAccessor = verify(accessorTarget);
    assert.equal(viaAccessor.status, 'update-verified', label);
    assert.equal(reads, 1, `${label}: target.bytes read more than once`);
    assert.ok(viaAccessor.target.equals(vouched), `${label}: returned bytes differ from hashed bytes`);
    assert.equal(sha256(viaAccessor.target), viaAccessor.nextState.app.digest, label);

    // Plain buffer: the result is a private copy, so a caller mutation after
    // verification cannot change the bytes that were reported as verified.
    const callerBuffer = Buffer.from(vouched);
    const viaBuffer = verify({ path: TARGET_PATH, bytes: callerBuffer });
    assert.equal(viaBuffer.status, 'update-verified', label);
    assert.notEqual(viaBuffer.target, callerBuffer, `${label}: result aliases the caller buffer`);
    callerBuffer.fill(0x41);
    assert.ok(viaBuffer.target.equals(vouched), `${label}: caller mutation reached the result`);
    assert.equal(sha256(viaBuffer.target), viaBuffer.nextState.app.digest, label);
  }
});

test('target size gate uses the intrinsic byte length, not caller-owned properties', () => {
  const root = rootMetadata();
  const { bundle, raw } = rawBoundBundle(root);
  const limits = { ...DEFAULT_LIMITS, targetBytes: 8 };
  const bytes = Buffer.from(bundle.target.bytes);
  assert.ok(bytes.length > limits.targetBytes);
  Object.defineProperty(bytes, 'length', { value: 1 });
  Object.defineProperty(bytes, 'byteLength', { value: 1 });

  assertCode('TARGET_TOO_LARGE', () => verifyOfflineBundleBytes({
    trustedState: trustedState(root),
    bundle: { ...raw, target: { path: TARGET_PATH, bytes } },
    targetPath: TARGET_PATH,
    now: NOW,
    limits,
  }));
});

test('a canonically equal caller object never replaces the parse of the hashed bytes', () => {
  const root = rootMetadata();
  const { bundle, raw } = rawBoundBundle(root);
  const hiddenPath = 'apps/hidden.cwap';
  const hiddenBytes = Buffer.from('never-vouched-by-the-hashed-targets-file', 'utf8');

  // A non-enumerable entry is invisible to the canonical comparison but visible
  // to a direct lookup. Only the object parsed from the hashed bytes may be used.
  const supplied = structuredClone(bundle.targets);
  Object.defineProperty(supplied.signed.targets, hiddenPath, {
    enumerable: false,
    value: {
      length: hiddenBytes.length,
      hashes: { sha256: sha256(hiddenBytes) },
      custom: { app_id: 'demo.app', app_version: 2, capabilities: ['storage.read'] },
    },
  });
  const state = trustedState(root);
  delete state.app.targetPath;

  assertCode('TARGET_NOT_FOUND', () => verifyOfflineBundle({
    trustedState: state,
    bundle: {
      roots: [],
      timestamp: bundle.timestamp,
      snapshot: bundle.snapshot,
      targets: supplied,
      rawMetadata: { snapshot: raw.snapshot, targets: raw.targets },
      target: { path: hiddenPath, bytes: hiddenBytes },
    },
    targetPath: hiddenPath,
    now: NOW,
  }));

  const result = verifyTopLevelMetadata({
    trustedState: trustedState(root),
    bundle: {
      roots: [],
      timestamp: bundle.timestamp,
      snapshot: bundle.snapshot,
      targets: supplied,
      rawMetadata: { snapshot: raw.snapshot, targets: raw.targets },
    },
    now: NOW,
  });
  assert.equal(result.status, 'metadata-verified');
  assert.notEqual(result.targets, supplied, 'verified targets object is the caller object');
  assert.equal(Object.hasOwn(result.targets.signed.targets, hiddenPath), false);
  assert.ok(canonicalBytes(result.targets).equals(
    canonicalBytes(JSON.parse(raw.targets.toString('utf8'))),
  ));
});

test('raw ingress enforces the POUF value domain outside the signed portion too', () => {
  const root = rootMetadata();
  const { bundle, raw } = rawBoundBundle(root);
  // Escape sequences as TEXT in the file bytes (not JS-decoded characters).
  const withEnvelopeField = (fieldJson) => Buffer.from(
    raw.timestamp.toString('utf8').replace(/^\{/, `{\n  "x": ${fieldJson},`),
    'utf8',
  );
  const verifyWithTimestamp = (timestamp) => verifyOfflineBundleBytes({
    trustedState: trustedState(root),
    bundle: { ...raw, timestamp, target: bundle.target },
    targetPath: TARGET_PATH,
    now: NOW,
  });

  assert.equal(verifyWithTimestamp(withEnvelopeField('"ok"')).status, 'update-verified');
  assertCode('INVALID_UNICODE', () => verifyWithTimestamp(withEnvelopeField(String.raw`"\ud800"`)));
  assertCode('INVALID_NUMBER', () => verifyWithTimestamp(withEnvelopeField('9007199254740993')));
});
