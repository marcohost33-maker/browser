import {
  constants as cryptoConstants,
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_LIMITS,
  TufSpikeError,
} from '../tuf-offline-metadata/tuf-offline.js';
import { parseTufMetadataBytes } from '../tuf-offline-metadata/strict-json.js';

export const CONFORMANCE_LIMITS = Object.freeze({
  ...DEFAULT_LIMITS,
  metadataBytes: 5 * 1024 * 1024,
  targetBytes: 128 * 1024 * 1024,
  jsonDepth: 64,
  jsonNodes: 200_000,
  rootKeys: 256,
  signatures: 128,
  rootUpdates: 64,
});

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const HEX = /^[0-9a-f]+$/i;

function fail(code, message, details = undefined) {
  throw new TufSpikeError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareUnicodeCodePoints(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    const ac = a[index].codePointAt(0);
    const bc = b[index].codePointAt(0);
    if (ac !== bc) return ac - bc;
  }
  return a.length - b.length;
}

function tufCanonicalString(value) {
  // securesystemslib.formats.encode_canonical implements the OLPC canonical
  // JSON dialect: only backslash and quote are escaped. Do not use
  // JSON.stringify here: it has different escaping semantics.
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function tufCanonicalJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') return tufCanonicalString(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      fail('INVALID_NUMBER', 'TUF canonical JSON requires a safe integer in this client');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => tufCanonicalJson(entry)).join(',')}]`;
  }
  if (!isObject(value)) {
    fail('INVALID_CANONICAL_TYPE', 'unsupported TUF canonical JSON value');
  }
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  return `{${keys.map((key) => (
    `${tufCanonicalString(key)}:${tufCanonicalJson(value[key])}`
  )).join(',')}}`;
}

function tufCanonicalBytes(value) {
  return Buffer.from(tufCanonicalJson(value), 'utf8');
}

function defaultKeyId(key) {
  if (!isObject(key)
      || typeof key.keytype !== 'string'
      || typeof key.scheme !== 'string'
      || !isObject(key.keyval)) {
    fail('INVALID_KEY', 'invalid TUF key object');
  }
  // TUF clients recalculate the key ID from the complete canonical key
  // representation they received. This intentionally preserves unrecognized
  // fields: conformance fixtures verify that they participate in the key ID.
  return hashHex(tufCanonicalBytes(key), 'sha256');
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('INVALID_VERSION', `${label} must be a positive safe integer`);
  }
}

function specVersionMatches10(value) {
  return typeof value === 'string' && /^1\.0(?:\.\d+)?$/.test(value);
}

function assertRoleMetadata(metadata, role, now, { checkExpiry = true } = {}) {
  if (!isObject(metadata) || !Array.isArray(metadata.signatures) || !isObject(metadata.signed)) {
    fail('INVALID_METADATA', `${role} metadata has an invalid envelope`);
  }
  if (metadata.signed._type !== role) {
    fail('ROLE_MISMATCH', `expected ${role} metadata`);
  }
  if (!specVersionMatches10(metadata.signed.spec_version)) {
    fail('SPEC_VERSION', `${role} metadata is not compatible with TUF 1.0.x`);
  }
  positiveInteger(metadata.signed.version, `${role}.version`);
  if (checkExpiry) assertNotExpired(metadata.signed.expires, now, role);
}

function assertNotExpired(expires, now, role) {
  if (typeof expires !== 'string') fail('INVALID_EXPIRY', `${role}.expires must be a string`);
  const expiry = Date.parse(expires);
  if (!Number.isFinite(expiry)) fail('INVALID_EXPIRY', `${role} expiry is invalid`);
  if (expiry <= now.getTime()) {
    fail('EXPIRED_METADATA', `${role} metadata is expired`, { expires });
  }
}

function assertRootShape(rootSigned) {
  if (!isObject(rootSigned.keys) || !isObject(rootSigned.roles)) {
    fail('INVALID_ROOT', 'root metadata must contain keys and roles');
  }

  for (const [keyId, key] of Object.entries(rootSigned.keys)) {
    if (typeof keyId !== 'string' || !isObject(key)) {
      fail('INVALID_KEYID', 'root contains an invalid key entry');
    }
    if (defaultKeyId(key) !== keyId) {
      fail('KEYID_MISMATCH', `root key id does not match canonical key object: ${keyId}`);
    }
  }

  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    const spec = rootSigned.roles[role];
    if (!isObject(spec) || !Array.isArray(spec.keyids)) {
      fail('INVALID_ROOT_ROLE', `root role ${role} is missing`);
    }
    positiveInteger(spec.threshold, `${role}.threshold`);
    const unique = new Set(spec.keyids);
    if (unique.size !== spec.keyids.length) {
      fail('DUPLICATE_ROLE_KEY', `${role} contains duplicate key ids`);
    }
    for (const keyId of unique) {
      if (!Object.hasOwn(rootSigned.keys, keyId)) {
        fail('UNKNOWN_ROLE_KEY', `${role} references unknown key ${keyId}`);
      }
    }
  }
}

function publicKeyFor(key) {
  if (!isObject(key) || !isObject(key.keyval) || typeof key.keyval.public !== 'string') {
    return null;
  }

  if (key.keytype === 'ed25519' && key.scheme === 'ed25519' && /^[0-9a-f]{64}$/i.test(key.keyval.public)) {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key.keyval.public, 'hex')]),
      format: 'der',
      type: 'spki',
    });
  }

  if (key.keytype === 'ecdsa' && (
    key.scheme === 'ecdsa-sha2-nistp256'
    || key.scheme === 'ecdsa-sha2-nistp384'
  )) {
    return createPublicKey(key.keyval.public);
  }

  if (key.keytype === 'rsa' && /^rsassa-pss-sha(256|384|512)$/.test(key.scheme)) {
    return createPublicKey(key.keyval.public);
  }

  return null;
}

function verifyOneSignature(key, message, signatureHex) {
  if (typeof signatureHex !== 'string' || signatureHex.length === 0 || signatureHex.length % 2 !== 0 || !HEX.test(signatureHex)) {
    return false;
  }
  const publicKey = publicKeyFor(key);
  if (!publicKey) return false;
  const signature = Buffer.from(signatureHex, 'hex');

  if (key.keytype === 'ed25519') {
    return verifySignature(null, message, publicKey, signature);
  }

  if (key.keytype === 'ecdsa') {
    const algorithm = key.scheme.endsWith('nistp384') ? 'sha384' : 'sha256';
    return verifySignature(algorithm, message, publicKey, signature);
  }

  if (key.keytype === 'rsa') {
    const algorithm = key.scheme.endsWith('sha512')
      ? 'sha512'
      : key.scheme.endsWith('sha384') ? 'sha384' : 'sha256';
    return verifySignature(algorithm, message, {
      key: publicKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
    }, signature);
  }

  return false;
}

function verifyRoleSignatures(metadata, trustedRootSigned, role) {
  const roleSpec = trustedRootSigned.roles?.[role];
  if (!isObject(roleSpec) || !Array.isArray(roleSpec.keyids)) {
    fail('UNKNOWN_ROLE', `trusted root does not define role ${role}`);
  }

  const message = tufCanonicalBytes(metadata.signed);
  const seen = new Set();
  let valid = 0;

  for (const signature of metadata.signatures) {
    if (!isObject(signature) || typeof signature.keyid !== 'string') continue;
    if (seen.has(signature.keyid)) {
      fail('DUPLICATE_SIGNATURE', `${role} repeats signature key ${signature.keyid}`);
    }
    seen.add(signature.keyid);

    if (!roleSpec.keyids.includes(signature.keyid)) continue;
    const key = trustedRootSigned.keys?.[signature.keyid];
    if (!key) continue;
    if (verifyOneSignature(key, message, signature.sig)) valid += 1;
  }

  if (valid < roleSpec.threshold) {
    fail('SIGNATURE_THRESHOLD', `${role} signature threshold was not met`, {
      valid,
      threshold: roleSpec.threshold,
    });
  }
}

function sameRoleKeys(leftRoot, rightRoot, role) {
  const left = leftRoot.roles?.[role];
  const right = rightRoot.roles?.[role];
  if (!left || !right || left.threshold !== right.threshold) return false;
  const l = [...left.keyids].sort();
  const r = [...right.keyids].sort();
  return JSON.stringify(l) === JSON.stringify(r);
}

function hashHex(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest('hex');
}

function equalHex(actual, expected) {
  if (typeof expected !== 'string' || actual.length !== expected.length || !HEX.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function verifyHashes(bytes, hashes, label) {
  if (hashes === undefined) return;
  if (!isObject(hashes) || Object.keys(hashes).length === 0) {
    fail('INVALID_HASHES', `${label} hashes are invalid`);
  }

  const supported = Object.entries(hashes).filter(([algorithm]) => (
    algorithm === 'sha256' || algorithm === 'sha512'
  ));
  if (supported.length === 0) {
    fail('UNSUPPORTED_HASH', `${label} has no supported hash algorithm`);
  }
  for (const [algorithm, expected] of supported) {
    const actual = hashHex(bytes, algorithm);
    if (!equalHex(actual, expected)) {
      fail('HASH_MISMATCH', `${label} ${algorithm} mismatch`);
    }
  }
}

function verifyMetaDescriptor(bytes, descriptor, label) {
  if (!isObject(descriptor)) fail('INVALID_META_DESCRIPTOR', `${label} descriptor is invalid`);
  positiveInteger(descriptor.version, `${label}.version`);
  if (descriptor.length !== undefined) {
    if (!Number.isSafeInteger(descriptor.length) || descriptor.length < 0) {
      fail('INVALID_META_DESCRIPTOR', `${label} length is invalid`);
    }
    if (bytes.length !== descriptor.length) {
      fail('METADATA_LENGTH', `${label} length mismatch`);
    }
  }
  verifyHashes(bytes, descriptor.hashes, label);
}

function assertTimestampMeta(timestamp) {
  const meta = timestamp.signed.meta;
  if (!isObject(meta)) fail('INVALID_TIMESTAMP_META', 'timestamp meta must be an object');
  const keys = Object.keys(meta);
  if (keys.length !== 1 || keys[0] !== 'snapshot.json') {
    fail('INVALID_TIMESTAMP_META', 'timestamp must describe exactly snapshot.json');
  }
  return meta['snapshot.json'];
}

function assertSnapshotTargetsMeta(snapshot) {
  const meta = snapshot.signed.meta;
  if (!isObject(meta) || !isObject(meta['targets.json'])) {
    fail('INVALID_SNAPSHOT_META', 'snapshot must describe targets.json');
  }
  return meta['targets.json'];
}

function parseBytes(bytes, label, limits = CONFORMANCE_LIMITS) {
  return parseTufMetadataBytes(bytes, limits, label);
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  await writeFile(temp, bytes, { flag: 'w', mode: 0o600 });
  await rename(temp, filePath);
}

function metadataPath(metadataDir, role) {
  return path.join(metadataDir, `${role}.json`);
}

async function loadTrusted(metadataDir, role, limits = CONFORMANCE_LIMITS) {
  const bytes = await readOptional(metadataPath(metadataDir, role));
  if (!bytes) return null;
  return { bytes, metadata: parseBytes(bytes, role, limits) };
}

function urlJoin(base, relative) {
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(relative, normalized).toString();
}

async function fetchBytes(fetchImpl, url, { missingOk = false, maxBytes = CONFORMANCE_LIMITS.metadataBytes } = {}) {
  const response = await fetchImpl(url, { redirect: 'error' });
  if (missingOk && response.status === 404) return null;
  if (!response.ok) fail('HTTP_ERROR', `HTTP ${response.status} for ${url}`);

  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      fail('DOWNLOAD_TOO_LARGE', `response exceeds byte limit for ${url}`);
    }
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) fail('DOWNLOAD_TOO_LARGE', `response exceeds byte limit for ${url}`);
  return bytes;
}

function rootUpdateResult(previous, current) {
  return {
    timestampKeysRotated: !sameRoleKeys(previous.signed, current.signed, 'timestamp'),
    snapshotKeysRotated: !sameRoleKeys(previous.signed, current.signed, 'snapshot'),
    targetsKeysRotated: !sameRoleKeys(previous.signed, current.signed, 'targets'),
  };
}

function validateTrustedRole(entry, role, rootSigned, now, { checkExpiry = false } = {}) {
  if (!entry) return null;
  assertRoleMetadata(entry.metadata, role, now, { checkExpiry });
  verifyRoleSignatures(entry.metadata, rootSigned, role);
  return entry;
}

export async function refreshTopLevel({
  metadataDir,
  metadataUrl,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  limits = CONFORMANCE_LIMITS,
}) {
  if (typeof fetchImpl !== 'function') fail('INVALID_FETCH', 'fetch implementation is required');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_TIME', 'now must be valid');

  let rootEntry = await loadTrusted(metadataDir, 'root', limits);
  if (!rootEntry) fail('NO_TRUSTED_ROOT', 'root.json is missing');
  assertRoleMetadata(rootEntry.metadata, 'root', now, { checkExpiry: false });
  assertRootShape(rootEntry.metadata.signed);
  verifyRoleSignatures(rootEntry.metadata, rootEntry.metadata.signed, 'root');

  // Local metadata was accepted under the currently trusted root. Capture this
  // state before root rotation: after role-key rotation it is still valid rollback
  // evidence even though it may no longer verify under the new role keys.
  const previousTimestamp = await loadTrusted(metadataDir, 'timestamp', limits);
  const previousSnapshot = await loadTrusted(metadataDir, 'snapshot', limits);
  const previousTargets = await loadTrusted(metadataDir, 'targets', limits);
  validateTrustedRole(previousTimestamp, 'timestamp', rootEntry.metadata.signed, now);
  validateTrustedRole(previousSnapshot, 'snapshot', rootEntry.metadata.signed, now);
  validateTrustedRole(previousTargets, 'targets', rootEntry.metadata.signed, now);

  let roleRotation = {
    timestampKeysRotated: false,
    snapshotKeysRotated: false,
    targetsKeysRotated: false,
  };
  for (let index = 0; index < limits.rootUpdates; index += 1) {
    const nextVersion = rootEntry.metadata.signed.version + 1;
    const candidateBytes = await fetchBytes(
      fetchImpl,
      urlJoin(metadataUrl, `${nextVersion}.root.json`),
      { missingOk: true, maxBytes: limits.metadataBytes },
    );
    if (candidateBytes === null) break;

    const candidate = parseBytes(candidateBytes, 'root', limits);
    assertRoleMetadata(candidate, 'root', now, { checkExpiry: false });
    assertRootShape(candidate.signed);
    if (candidate.signed.version !== nextVersion) {
      fail('ROOT_VERSION', 'root version does not match versioned URL');
    }
    verifyRoleSignatures(candidate, rootEntry.metadata.signed, 'root');
    verifyRoleSignatures(candidate, candidate.signed, 'root');

    const delta = rootUpdateResult(rootEntry.metadata, candidate);
    roleRotation.timestampKeysRotated ||= delta.timestampKeysRotated;
    roleRotation.snapshotKeysRotated ||= delta.snapshotKeysRotated;
    roleRotation.targetsKeysRotated ||= delta.targetsKeysRotated;

    rootEntry = { bytes: candidateBytes, metadata: candidate };
    await atomicWrite(metadataPath(metadataDir, 'root'), candidateBytes);
  }
  assertNotExpired(rootEntry.metadata.signed.expires, now, 'root');

  const trustedTimestamp = roleRotation.timestampKeysRotated ? null : previousTimestamp;
  const trustedSnapshot = roleRotation.snapshotKeysRotated ? null : previousSnapshot;

  const timestampBytes = await fetchBytes(
    fetchImpl,
    urlJoin(metadataUrl, 'timestamp.json'),
    { maxBytes: limits.metadataBytes },
  );
  const timestamp = parseBytes(timestampBytes, 'timestamp', limits);
  assertRoleMetadata(timestamp, 'timestamp', now);
  verifyRoleSignatures(timestamp, rootEntry.metadata.signed, 'timestamp');
  const snapshotDescriptor = assertTimestampMeta(timestamp);

  if (trustedTimestamp && timestamp.signed.version < trustedTimestamp.metadata.signed.version) {
    fail('TIMESTAMP_ROLLBACK', 'timestamp version rolled back');
  }
  if (trustedTimestamp && timestamp.signed.version === trustedTimestamp.metadata.signed.version) {
    return {
      root: rootEntry,
      timestamp: trustedTimestamp,
      snapshot: previousSnapshot,
      targets: previousTargets,
      changed: false,
    };
  }

  // Snapshot rollback is detected before the new timestamp is persisted. A
  // missing/invalid newer snapshot may still leave a valid newer timestamp on
  // disk, but a timestamp that *claims* an older snapshot is itself rejected.
  if (trustedSnapshot && snapshotDescriptor.version < trustedSnapshot.metadata.signed.version) {
    fail('SNAPSHOT_ROLLBACK', 'timestamp points to an older snapshot');
  }

  await atomicWrite(metadataPath(metadataDir, 'timestamp'), timestampBytes);
  const timestampEntry = { bytes: timestampBytes, metadata: timestamp };

  let snapshotEntry;
  let snapshotWasDownloaded = false;
  if (trustedSnapshot && snapshotDescriptor.version === trustedSnapshot.metadata.signed.version) {
    verifyMetaDescriptor(trustedSnapshot.bytes, snapshotDescriptor, 'snapshot');
    snapshotEntry = trustedSnapshot;
  } else {
    const name = rootEntry.metadata.signed.consistent_snapshot === true
      ? `${snapshotDescriptor.version}.snapshot.json`
      : 'snapshot.json';
    const snapshotBytes = await fetchBytes(
      fetchImpl,
      urlJoin(metadataUrl, name),
      { maxBytes: limits.metadataBytes },
    );
    verifyMetaDescriptor(snapshotBytes, snapshotDescriptor, 'snapshot');
    const snapshot = parseBytes(snapshotBytes, 'snapshot', limits);
    assertRoleMetadata(snapshot, 'snapshot', now);
    verifyRoleSignatures(snapshot, rootEntry.metadata.signed, 'snapshot');
    if (snapshot.signed.version !== snapshotDescriptor.version) {
      fail('SNAPSHOT_VERSION', 'snapshot version does not match timestamp descriptor');
    }
    snapshotEntry = { bytes: snapshotBytes, metadata: snapshot };
    snapshotWasDownloaded = true;
  }

  const targetsDescriptor = assertSnapshotTargetsMeta(snapshotEntry.metadata);

  if (!roleRotation.snapshotKeysRotated && previousSnapshot) {
    const oldMeta = previousSnapshot.metadata.signed.meta;
    const newMeta = snapshotEntry.metadata.signed.meta;
    if (isObject(oldMeta) && isObject(newMeta)) {
      for (const [name, oldDescriptor] of Object.entries(oldMeta)) {
        const current = newMeta[name];
        if (!isObject(current)) {
          fail('SNAPSHOT_ROLE_REMOVAL', `snapshot removed previously trusted metadata: ${name}`);
        }
        if (Number.isSafeInteger(oldDescriptor?.version)
            && Number.isSafeInteger(current.version)
            && current.version < oldDescriptor.version) {
          fail('SNAPSHOT_META_ROLLBACK', `snapshot rolled back metadata: ${name}`);
        }
      }
    }
  }

  const oldTargetsVersion = roleRotation.snapshotKeysRotated
    ? 0
    : Math.max(
      previousTargets?.metadata?.signed?.version ?? 0,
      previousSnapshot?.metadata?.signed?.meta?.['targets.json']?.version ?? 0,
    );
  if (targetsDescriptor.version < oldTargetsVersion) {
    fail('TARGETS_ROLLBACK', 'snapshot points to older targets metadata');
  }

  // Once all rollback properties encoded by snapshot have passed, snapshot can
  // be persisted even if the subsequent targets fetch fails.
  if (snapshotWasDownloaded) {
    await atomicWrite(metadataPath(metadataDir, 'snapshot'), snapshotEntry.bytes);
  }

  const reusableTargets = !roleRotation.targetsKeysRotated
    && !roleRotation.snapshotKeysRotated
    && previousTargets
    && targetsDescriptor.version === previousTargets.metadata.signed.version
    ? previousTargets
    : null;

  let targetsEntry;
  if (reusableTargets) {
    verifyMetaDescriptor(reusableTargets.bytes, targetsDescriptor, 'targets');
    targetsEntry = reusableTargets;
  } else {
    const name = rootEntry.metadata.signed.consistent_snapshot === true
      ? `${targetsDescriptor.version}.targets.json`
      : 'targets.json';
    const targetsBytes = await fetchBytes(
      fetchImpl,
      urlJoin(metadataUrl, name),
      { maxBytes: limits.metadataBytes },
    );
    verifyMetaDescriptor(targetsBytes, targetsDescriptor, 'targets');
    const targets = parseBytes(targetsBytes, 'targets', limits);
    assertRoleMetadata(targets, 'targets', now);
    verifyRoleSignatures(targets, rootEntry.metadata.signed, 'targets');
    if (targets.signed.version !== targetsDescriptor.version) {
      fail('TARGETS_VERSION', 'targets version does not match snapshot descriptor');
    }
    targetsEntry = { bytes: targetsBytes, metadata: targets };
    await atomicWrite(metadataPath(metadataDir, 'targets'), targetsBytes);
  }

  return {
    root: rootEntry,
    timestamp: timestampEntry,
    snapshot: snapshotEntry,
    targets: targetsEntry,
    changed: true,
  };
}

function safeTargetPath(targetDir, targetName) {
  if (typeof targetName !== 'string' || targetName.length === 0 || targetName.includes('\\')) {
    fail('INVALID_TARGET_PATH', 'invalid target path');
  }
  const parts = targetName.split('/');
  if (targetName.startsWith('/') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail('INVALID_TARGET_PATH', 'unsafe target path');
  }

  const root = path.resolve(targetDir);
  const resolved = path.resolve(root, ...parts);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    fail('INVALID_TARGET_PATH', 'target escapes target directory');
  }
  return resolved;
}

function verifyTargetBytes(bytes, descriptor, targetName) {
  if (!isObject(descriptor)
      || !Number.isSafeInteger(descriptor.length)
      || descriptor.length < 0
      || !isObject(descriptor.hashes)) {
    fail('INVALID_TARGET_DESCRIPTOR', `invalid descriptor for ${targetName}`);
  }
  if (bytes.length !== descriptor.length) {
    fail('TARGET_LENGTH', `target length mismatch for ${targetName}`);
  }
  verifyHashes(bytes, descriptor.hashes, targetName);
}

function targetDownloadName(targetName, descriptor, consistentSnapshot) {
  const parts = targetName.split('/');
  const filename = parts.pop();
  if (!consistentSnapshot) return [...parts, filename].map(encodeURIComponent).join('/');

  const prefix = descriptor.hashes?.sha256 ?? descriptor.hashes?.sha512;
  if (typeof prefix !== 'string') {
    fail('UNSUPPORTED_HASH', 'consistent snapshot target has no supported hash');
  }
  return [...parts.map(encodeURIComponent), encodeURIComponent(`${prefix}.${filename}`)].join('/');
}

async function cachedTargetMatches(filePath, descriptor, targetName) {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size !== descriptor.length) return false;
    const bytes = await readFile(filePath);
    verifyTargetBytes(bytes, descriptor, targetName);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    if (error instanceof TufSpikeError) return false;
    throw error;
  }
}

export async function downloadTopLevelTargets({
  metadataDir,
  metadataUrl,
  targetBaseUrl,
  targetDir,
  targetNames,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  limits = CONFORMANCE_LIMITS,
}) {
  const refreshed = await refreshTopLevel({
    metadataDir,
    metadataUrl,
    fetchImpl,
    now,
    limits,
  });
  const targets = refreshed.targets?.metadata;
  if (!targets || !isObject(targets.signed.targets)) {
    fail('INVALID_TARGETS', 'trusted targets metadata is unavailable');
  }

  for (const targetName of targetNames) {
    const descriptor = targets.signed.targets[targetName];
    if (!descriptor) {
      if (isObject(targets.signed.delegations)) {
        fail('UNSUPPORTED_DELEGATION', `target ${targetName} requires delegation traversal`);
      }
      fail('TARGET_NOT_FOUND', `target not found: ${targetName}`);
    }

    const destination = safeTargetPath(targetDir, targetName);
    await mkdir(path.dirname(destination), { recursive: true });
    if (await cachedTargetMatches(destination, descriptor, targetName)) continue;

    const remoteName = targetDownloadName(
      targetName,
      descriptor,
      refreshed.root.metadata.signed.consistent_snapshot === true,
    );
    const bytes = await fetchBytes(fetchImpl, urlJoin(targetBaseUrl, remoteName), {
      maxBytes: Math.min(limits.targetBytes, Math.max(descriptor.length, 1)),
    });
    verifyTargetBytes(bytes, descriptor, targetName);
    await atomicWrite(destination, bytes);
  }
}
