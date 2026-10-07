#!/usr/bin/env node
import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
} from 'node:crypto';
import { writeFileSync } from 'node:fs';

import {
  canonicalBytes,
  keyIdFor,
  POUF,
  sha256,
} from '../tuf-offline.js';

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error('usage: node generate-corpus.mjs <output.json>');
}

const NOW = '2026-09-27T19:45:00.000Z';
const FUTURE = '2027-09-27T19:45:00Z';
const PAST = '2025-09-27T19:45:00Z';
const TARGET_PATH = 'artifacts/demo.bin';
const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);
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
  const seed = Buffer.from(
    sha256(`browser-tuf-differential-key:${name}`),
    'hex',
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = createPublicKey(privateKey).export({
    format: 'der',
    type: 'spki',
  });
  return {
    privateKey,
    public: publicDer.subarray(-32).toString('hex'),
  };
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
  KEY_NAMES.map((name) => {
    const key = tufKey(name);
    return [name, {
      key,
      keyId: keyIdFor(key),
      privateKey: MATERIAL[name].privateKey,
    }];
  }),
));

function signatureFor(signed, signerName) {
  return {
    keyid: KEYS[signerName].keyId,
    sig: signBytes(
      null,
      canonicalBytes(signed),
      KEYS[signerName].privateKey,
    ).toString('hex'),
  };
}

function signedMetadata(signed, signerNames) {
  return {
    signatures: signerNames.map((name) => signatureFor(signed, name)),
    signed,
  };
}

function resign(metadata, signerNames) {
  metadata.signatures = signerNames.map(
    (name) => signatureFor(metadata.signed, name),
  );
}

function rawMetadata(metadata) {
  return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function descriptor(rawBytes, version) {
  return {
    version,
    length: rawBytes.length,
    hashes: { sha256: sha256(rawBytes) },
  };
}

function rootMetadata({
  version = 1,
  rootNames = ['rootA', 'rootB'],
  timestampName = 'timestampA',
  snapshotName = 'snapshotA',
  signerNames = rootNames,
} = {}) {
  const names = [...new Set([
    ...rootNames,
    timestampName,
    snapshotName,
    'targetsA',
  ])];
  const keys = Object.fromEntries(
    names.map((name) => [KEYS[name].keyId, KEYS[name].key]),
  );
  return signedMetadata({
    _type: 'root',
    spec_version: POUF.specVersion,
    version,
    expires: FUTURE,
    consistent_snapshot: true,
    keys,
    roles: {
      root: {
        keyids: rootNames.map((name) => KEYS[name].keyId),
        threshold: 2,
      },
      timestamp: {
        keyids: [KEYS[timestampName].keyId],
        threshold: 1,
      },
      snapshot: {
        keyids: [KEYS[snapshotName].keyId],
        threshold: 1,
      },
      targets: {
        keyids: [KEYS.targetsA.keyId],
        threshold: 1,
      },
    },
  }, signerNames);
}

function buildChain({
  timestampSigner = 'timestampA',
  snapshotSigner = 'snapshotA',
  targetsSigner = 'targetsA',
  timestampVersion = 2,
  snapshotVersion = 2,
  targetsVersion = 2,
  timestampExpires = FUTURE,
  snapshotExpires = FUTURE,
  targetsExpires = FUTURE,
  mutateTargets = () => {},
  mutateSnapshot = () => {},
  mutateTimestamp = () => {},
} = {}) {
  const targetBytes = Buffer.from('oracle-target-v2', 'utf8');
  const targets = signedMetadata({
    _type: 'targets',
    spec_version: POUF.specVersion,
    version: targetsVersion,
    expires: targetsExpires,
    targets: {
      [TARGET_PATH]: {
        length: targetBytes.length,
        hashes: { sha256: sha256(targetBytes) },
      },
    },
  }, [targetsSigner]);
  mutateTargets(targets);
  resign(targets, [targetsSigner]);
  const targetsRaw = rawMetadata(targets);

  const snapshot = signedMetadata({
    _type: 'snapshot',
    spec_version: POUF.specVersion,
    version: snapshotVersion,
    expires: snapshotExpires,
    meta: {
      'targets.json': descriptor(targetsRaw, targets.signed.version),
    },
  }, [snapshotSigner]);
  mutateSnapshot(snapshot);
  resign(snapshot, [snapshotSigner]);
  const snapshotRaw = rawMetadata(snapshot);

  const timestamp = signedMetadata({
    _type: 'timestamp',
    spec_version: POUF.specVersion,
    version: timestampVersion,
    expires: timestampExpires,
    meta: {
      'snapshot.json': descriptor(snapshotRaw, snapshot.signed.version),
    },
  }, [timestampSigner]);
  mutateTimestamp(timestamp);
  resign(timestamp, [timestampSigner]);
  const timestampRaw = rawMetadata(timestamp);

  return {
    objects: { timestamp, snapshot, targets },
    raw: { timestampRaw, snapshotRaw, targetsRaw },
  };
}

function encode(bytes) {
  return Buffer.from(bytes).toString('base64');
}

const trustedRoot = rootMetadata();
const trustedRootRaw = rawMetadata(trustedRoot);

function makeCase({
  name,
  expected,
  mustAgree = true,
  roots = [],
  chain = buildChain(),
  timestampRaw = chain.raw.timestampRaw,
  note,
  trustedVersions = null,
  preloadTimestampRaw = null,
}) {
  return {
    name,
    now: NOW,
    must_agree: mustAgree,
    expected_browser: expected,
    expected_python_tuf: mustAgree ? expected : null,
    note: note ?? null,
    trusted_versions: trustedVersions,
    preload_timestamp_b64: preloadTimestampRaw === null
      ? null
      : encode(preloadTimestampRaw),
    trusted_root_b64: encode(trustedRootRaw),
    roots_b64: roots.map((value) => encode(value)),
    timestamp_b64: encode(timestampRaw),
    snapshot_b64: encode(chain.raw.snapshotRaw),
    targets_b64: encode(chain.raw.targetsRaw),
  };
}

const cases = [];

cases.push(makeCase({
  name: 'valid-pretty-envelope',
  expected: 'accept',
  note: 'Exact descriptor bytes are pretty-printed, not canonical full-envelope JSON.',
}));

cases.push(makeCase({
  name: 'valid-unicode-key-ordering',
  expected: 'accept',
  chain: buildChain({
    mutateTargets(metadata) {
      metadata.signed['\uE000'] = 'bmp-private-use';
      metadata.signed['\u{10000}'] = 'astral-plane';
    },
  }),
  note: 'Exercises canonical object-key ordering across BMP and astral Unicode code points.',
}));

{
  const chain = buildChain();
  const original = chain.objects.timestamp.signatures[0].sig;
  chain.objects.timestamp.signatures[0].sig =
    `${original[0] === '0' ? '1' : '0'}${original.slice(1)}`;
  cases.push(makeCase({
    name: 'reject-invalid-timestamp-signature',
    expected: 'reject',
    chain,
    timestampRaw: rawMetadata(chain.objects.timestamp),
  }));
}

cases.push(makeCase({
  name: 'reject-snapshot-hash-mismatch',
  expected: 'reject',
  chain: buildChain({
    mutateTimestamp(metadata) {
      metadata.signed.meta['snapshot.json'].hashes.sha256 = '0'.repeat(64);
    },
  }),
}));

cases.push(makeCase({
  name: 'reject-targets-hash-mismatch',
  expected: 'reject',
  chain: buildChain({
    mutateSnapshot(metadata) {
      metadata.signed.meta['targets.json'].hashes.sha256 = '0'.repeat(64);
    },
  }),
}));

cases.push(makeCase({
  name: 'reject-expired-timestamp',
  expected: 'reject',
  chain: buildChain({ timestampExpires: PAST }),
}));

cases.push(makeCase({
  name: 'reject-wrong-timestamp-type',
  expected: 'reject',
  chain: buildChain({
    mutateTimestamp(metadata) {
      metadata.signed._type = 'snapshot';
    },
  }),
}));

{
  const preload = buildChain({ timestampVersion: 2 });
  const rollback = buildChain({ timestampVersion: 1 });
  cases.push(makeCase({
    name: 'reject-timestamp-rollback-against-trusted-state',
    expected: 'reject',
    chain: rollback,
    trustedVersions: { timestamp: 2, snapshot: 0, targets: 0 },
    preloadTimestampRaw: preload.raw.timestampRaw,
    note: 'Stateful rollback: candidate timestamp v1 follows an already trusted v2.',
  }));
}

cases.push(makeCase({
  name: 'reject-snapshot-version-mismatch',
  expected: 'reject',
  chain: buildChain({
    mutateTimestamp(metadata) {
      metadata.signed.meta['snapshot.json'].version = 3;
    },
  }),
}));

{
  const rotatedRoot = rootMetadata({
    version: 2,
    rootNames: ['rootB', 'rootC'],
    timestampName: 'timestampB',
    snapshotName: 'snapshotB',
    signerNames: ['rootA', 'rootB', 'rootC'],
  });
  cases.push(makeCase({
    name: 'accept-root-rotation-old-and-new-threshold',
    expected: 'accept',
    roots: [rawMetadata(rotatedRoot)],
    chain: buildChain({
      timestampSigner: 'timestampB',
      snapshotSigner: 'snapshotB',
    }),
  }));
}

// #56: a role signed by ANOTHER top-level role's key. Every key below is in
// root.keys, so only the keyid-to-role binding (role.keyids) can reject it.
for (const [role, signer] of [
  ['timestamp', 'snapshotA'],
  ['snapshot', 'targetsA'],
  ['targets', 'timestampA'],
]) {
  cases.push(makeCase({
    name: `reject-${role}-signed-by-${signer}-key`,
    expected: 'reject',
    chain: buildChain({ [`${role}Signer`]: signer }),
    note: `${role} carries a valid signature by a key that root authorizes only for another role (#56).`,
  }));
}

{
  const badRotatedRoot = rootMetadata({
    version: 2,
    rootNames: ['rootB', 'rootC'],
    timestampName: 'timestampB',
    snapshotName: 'snapshotB',
    signerNames: ['rootB', 'rootC'],
  });
  cases.push(makeCase({
    name: 'reject-root-rotation-missing-old-threshold',
    expected: 'reject',
    roots: [rawMetadata(badRotatedRoot)],
    chain: buildChain({
      timestampSigner: 'timestampB',
      snapshotSigner: 'snapshotB',
    }),
  }));
}

{
  const chain = buildChain();
  const source = chain.raw.timestampRaw.toString('utf8');
  const marker = '    "version": 2,';
  if (!source.includes(marker)) {
    throw new Error('duplicate-key corpus marker not found');
  }
  const duplicate = source.replace(
    marker,
    '    "version": 999,\n    "version": 2,',
  );
  cases.push(makeCase({
    name: 'profile-observation-duplicate-json-key',
    expected: 'reject',
    mustAgree: false,
    chain,
    timestampRaw: Buffer.from(duplicate, 'utf8'),
    note: 'Browser POUF rejects duplicate names before object construction; python-tuf behavior is recorded, not prescribed.',
  }));
}

{
  const chain = buildChain();
  const source = chain.raw.timestampRaw.toString('utf8');
  const marker = '    "version": 2,';
  if (!source.includes(marker)) {
    throw new Error('float corpus marker not found');
  }
  const decimal = source.replace(marker, '    "version": 2.0,');
  cases.push(makeCase({
    name: 'profile-observation-decimal-integer-spelling',
    expected: 'reject',
    mustAgree: false,
    chain,
    timestampRaw: Buffer.from(decimal, 'utf8'),
    note: 'Browser integer-only POUF rejects decimal/exponent spellings before numeric collapse.',
  }));
}

const corpus = {
  schema_version: 1,
  generated_at: NOW,
  project_pouf: POUF.specVersion,
  oracle_profile: {
    keytype: 'ed25519',
    scheme: 'ed25519',
    hash: 'sha256',
  },
  cases,
};

writeFileSync(outputPath, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`wrote ${cases.length} differential cases to ${outputPath}`);
