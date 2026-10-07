// Deterministic TUF v1.0.35 repository for the coupled-update tests and crash matrix.
//
// Keys are Ed25519 seeds derived from public labels, so every run produces the same
// bytes and no reusable private key material exists anywhere. Metadata files are
// pretty-printed JSON (not canonical form) on purpose: signatures cover the canonical
// `signed` object while descriptors bind the exact file bytes, and the fixtures keep
// those two byte domains apart exactly as a real repository would.

import { createPrivateKey, createPublicKey, sign as signBytes } from 'node:crypto';

import { canonicalBytes, keyIdFor, POUF, sha256 } from '../../tuf-offline-metadata/tuf-offline.js';

export const APP_ID = 'org.coworkerz.demo';
export const TARGET_PATH = 'apps/org.coworkerz.demo/app.pkg';
export const FIXED_NOW = new Date('2026-10-07T12:00:00.000Z');
export const FAR_FUTURE = '2030-01-01T00:00:00Z';

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const KEY_NAMES = Object.freeze([
  'rootA', 'rootB', 'timestampA', 'timestampB', 'snapshotA', 'snapshotB', 'targetsA', 'targetsB', 'intruder',
]);

function keyMaterial(name) {
  const seed = Buffer.from(sha256(`browser-update-activation-test-key:${name}`), 'hex');
  const privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const publicHex = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const key = { keytype: 'ed25519', scheme: 'ed25519', keyval: { public: publicHex } };
  return { privateKey, key, keyId: keyIdFor(key) };
}

export const KEYS = Object.freeze(Object.fromEntries(KEY_NAMES.map((name) => [name, keyMaterial(name)])));

export function fileBytes(metadata) {
  return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

export function signMetadata(signed, signerNames) {
  return {
    signatures: signerNames.map((name) => ({
      keyid: KEYS[name].keyId,
      sig: signBytes(null, canonicalBytes(signed), KEYS[name].privateKey).toString('hex'),
    })),
    signed,
  };
}

function descriptor(bytes, version) {
  return { version, length: bytes.length, hashes: { sha256: sha256(bytes) } };
}

/**
 * Root metadata bytes. Version 1 uses timestamp/snapshot/targets keys A; a later
 * root can rotate the online keys to B (`rotateOnline`) or the targets key to B
 * (`rotateTargets`). Root keys and threshold stay the same, so every root satisfies
 * both the old and the new root threshold.
 */
export function rootBytes({
  version = 1,
  rotateOnline = false,
  rotateTargets = false,
  expires = FAR_FUTURE,
  signers = ['rootA', 'rootB'],
} = {}) {
  const timestampKey = rotateOnline ? 'timestampB' : 'timestampA';
  const snapshotKey = rotateOnline ? 'snapshotB' : 'snapshotA';
  const targetsKey = rotateTargets ? 'targetsB' : 'targetsA';
  const names = ['rootA', 'rootB', timestampKey, snapshotKey, targetsKey];
  const signed = {
    _type: 'root',
    spec_version: POUF.specVersion,
    version,
    expires,
    consistent_snapshot: true,
    keys: Object.fromEntries(names.map((name) => [KEYS[name].keyId, KEYS[name].key])),
    roles: {
      root: { keyids: [KEYS.rootA.keyId, KEYS.rootB.keyId], threshold: 2 },
      timestamp: { keyids: [KEYS[timestampKey].keyId], threshold: 1 },
      snapshot: { keyids: [KEYS[snapshotKey].keyId], threshold: 1 },
      targets: { keyids: [KEYS[targetsKey].keyId], threshold: 1 },
    },
  };
  return fileBytes(signMetadata(signed, signers));
}

/** Deterministic opaque package bytes: the container format is not decided (D4). */
export function packageBytes(appVersion, variant = '') {
  return Buffer.from(`opaque package ${APP_ID} v${appVersion}${variant}\n${'#'.repeat(64 * appVersion)}\n`, 'utf8');
}

/**
 * One self-contained offline update bundle: optional new roots, then timestamp,
 * snapshot and targets for the package of `appVersion`. Versions default to the app
 * version, so successive releases advance every rollback floor.
 */
export function releaseBundle({
  appVersion,
  roots = [],
  timestampVersion = appVersion,
  snapshotVersion = appVersion,
  targetsVersion = appVersion,
  capabilities = ['storage.read'],
  rotateOnline = false,
  expires = FAR_FUTURE,
  packageVariant = '',
  signers = {},
} = {}) {
  const target = packageBytes(appVersion, packageVariant);
  const targets = fileBytes(signMetadata({
    _type: 'targets',
    spec_version: POUF.specVersion,
    version: targetsVersion,
    expires,
    targets: {
      [TARGET_PATH]: {
        length: target.length,
        hashes: { sha256: sha256(target) },
        custom: { app_id: APP_ID, app_version: appVersion, capabilities },
      },
    },
  }, signers.targets ?? ['targetsA']));
  const snapshot = fileBytes(signMetadata({
    _type: 'snapshot',
    spec_version: POUF.specVersion,
    version: snapshotVersion,
    expires,
    meta: { 'targets.json': descriptor(targets, targetsVersion) },
  }, signers.snapshot ?? [rotateOnline ? 'snapshotB' : 'snapshotA']));
  const timestamp = fileBytes(signMetadata({
    _type: 'timestamp',
    spec_version: POUF.specVersion,
    version: timestampVersion,
    expires,
    meta: { 'snapshot.json': descriptor(snapshot, snapshotVersion) },
  }, signers.timestamp ?? [rotateOnline ? 'timestampB' : 'timestampA']));
  return { roots, timestamp, snapshot, targets, target: { path: TARGET_PATH, bytes: target } };
}
