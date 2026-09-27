import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';

export const POUF = Object.freeze({
  specVersion: '1.0.35',
  signatureScheme: 'ed25519',
  hashAlgorithm: 'sha256',
});

export const DEFAULT_LIMITS = Object.freeze({
  metadataBytes: 64 * 1024,
  targetBytes: 64 * 1024 * 1024,
  signatures: 32,
  rootKeys: 64,
  rootUpdates: 32,
  targetCount: 10_000,
  capabilities: 128,
  jsonDepth: 32,
  jsonNodes: 50_000,
  targetPathLength: 1_024,
  targetPathComponents: 64,
});

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const HEX_64 = /^[0-9a-f]{64}$/;
const HEX_128 = /^[0-9a-f]{128}$/;
const TUF_UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export class TufSpikeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TufSpikeError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new TufSpikeError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedLimit(limits, name) {
  const value = limits?.[name] ?? DEFAULT_LIMITS[name];
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('INVALID_LIMIT', `${name} must be a positive safe integer`);
  }
  return value;
}

function assertStringWellFormed(value, label) {
  if (typeof value !== 'string') fail('INVALID_TYPE', `${label} must be a string`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail('INVALID_UNICODE', `${label} contains a lone high surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('INVALID_UNICODE', `${label} contains a lone low surrogate`);
    }
  }
}

function compareUnicodeCodePoints(left, right) {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();

  while (true) {
    const leftNext = leftIterator.next();
    const rightNext = rightIterator.next();
    if (leftNext.done || rightNext.done) {
      if (leftNext.done && rightNext.done) return 0;
      return leftNext.done ? -1 : 1;
    }

    const leftCodePoint = leftNext.value.codePointAt(0);
    const rightCodePoint = rightNext.value.codePointAt(0);
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
  }
}

function canonicalJsonValue(value, label, state, depth) {
  state.nodes += 1;
  if (state.nodes > state.maxNodes) {
    fail('JSON_NODE_LIMIT', `${label} exceeds the canonical JSON node limit`);
  }
  if (depth > state.maxDepth) {
    fail('JSON_DEPTH_LIMIT', `${label} exceeds the canonical JSON depth limit`);
  }

  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';

  if (typeof value === 'string') {
    assertStringWellFormed(value, label);
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      fail('INVALID_NUMBER', `${label} must be a finite safe integer`);
    }
    return String(value);
  }

  if (Array.isArray(value)) {
    if (state.active.has(value)) fail('CYCLIC_JSON', `${label} contains a cycle`);
    state.active.add(value);
    try {
      return `[${value.map((entry, index) => (
        canonicalJsonValue(entry, `${label}[${index}]`, state, depth + 1)
      )).join(',')}]`;
    } finally {
      state.active.delete(value);
    }
  }

  if (!isPlainObject(value)) {
    fail('INVALID_TYPE', `${label} must contain only JSON values`);
  }
  if (state.active.has(value)) fail('CYCLIC_JSON', `${label} contains a cycle`);

  state.active.add(value);
  try {
    const keys = Object.keys(value);
    for (const key of keys) assertStringWellFormed(key, `${label} key`);
    keys.sort(compareUnicodeCodePoints);
    return `{${keys.map((key) => (
      `${JSON.stringify(key)}:${canonicalJsonValue(value[key], `${label}.${key}`, state, depth + 1)}`
    )).join(',')}}`;
  } finally {
    state.active.delete(value);
  }
}

/**
 * Deterministic JSON for the spike POUF.
 *
 * This is deliberately smaller than a general JSON canonicalization library:
 * finite safe integers only, plain objects only, Unicode code-point key order
 * matching the OLPC canonical JSON used by python-tuf/securesystemslib, and explicit
 * depth/node bounds. Raw JSON parsing and duplicate-key rejection remain
 * outside this spike.
 */
export function canonicalJson(value, label = '$', limits = DEFAULT_LIMITS) {
  return canonicalJsonValue(value, label, {
    active: new WeakSet(),
    maxDepth: boundedLimit(limits, 'jsonDepth'),
    maxNodes: boundedLimit(limits, 'jsonNodes'),
    nodes: 0,
  }, 0);
}

export function canonicalBytes(value, limits = DEFAULT_LIMITS) {
  return Buffer.from(canonicalJson(value, '$', limits), 'utf8');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function keyIdFor(key, limits = DEFAULT_LIMITS) {
  return sha256(canonicalBytes(key, limits));
}

function metadataBytes(metadata, limits) {
  return canonicalBytes(metadata, limits);
}

function signedBytes(metadata, limits) {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.signed)) {
    fail('INVALID_METADATA', 'metadata must contain a signed object');
  }
  return canonicalBytes(metadata.signed, limits);
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('INVALID_VERSION', `${label} must be a positive safe integer`);
  }
}

function assertNotExpired(expires, fixedStartTime, roleName) {
  assertStringWellFormed(expires, `${roleName}.expires`);
  if (!TUF_UTC_SECONDS.test(expires)) {
    fail('INVALID_EXPIRY', `${roleName} expiry must use YYYY-MM-DDTHH:MM:SSZ`);
  }

  const expiry = Date.parse(expires);
  if (!Number.isFinite(expiry)) fail('INVALID_EXPIRY', `${roleName} has an invalid expiry timestamp`);

  const canonical = new Date(expiry).toISOString().replace('.000Z', 'Z');
  if (expires !== canonical) {
    fail('INVALID_EXPIRY', `${roleName} expiry is not a canonical UTC timestamp`);
  }

  if (expiry <= fixedStartTime.getTime()) {
    fail('EXPIRED_METADATA', `${roleName} metadata is expired`, { role: roleName, expires });
  }
}

function assertRoleMetadata(metadata, expectedRole, fixedStartTime, { checkExpiry = true } = {}) {
  if (!isPlainObject(metadata) || !Array.isArray(metadata.signatures) || !isPlainObject(metadata.signed)) {
    fail('INVALID_METADATA', `${expectedRole} metadata has an invalid envelope`);
  }
  if (metadata.signed._type !== expectedRole) {
    fail('ROLE_MISMATCH', `expected ${expectedRole} metadata`);
  }
  if (metadata.signed.spec_version !== POUF.specVersion) {
    fail('SPEC_VERSION', `${expectedRole} must use TUF ${POUF.specVersion}`);
  }
  assertPositiveInteger(metadata.signed.version, `${expectedRole}.version`);
  if (checkExpiry) assertNotExpired(metadata.signed.expires, fixedStartTime, expectedRole);
}

function assertMetadataLimit(metadata, limits, roleName, rawBytes = undefined) {
  if (!isPlainObject(metadata) || !Array.isArray(metadata.signatures) || !isPlainObject(metadata.signed)) {
    fail('INVALID_METADATA', `${roleName} metadata has an invalid envelope`);
  }

  let bytes;
  if (rawBytes === undefined) {
    // Object-mode remains for deterministic research fixtures. A real ingress must
    // provide the exact downloaded bytes so descriptor length/hash checks bind the
    // file that was actually received, not a re-serialization.
    bytes = metadataBytes(metadata, limits);
  } else {
    if (!(Buffer.isBuffer(rawBytes) || rawBytes instanceof Uint8Array)) {
      fail('INVALID_RAW_METADATA', `${roleName} raw metadata must be Buffer or Uint8Array`);
    }
    bytes = Buffer.from(rawBytes);
  }

  if (bytes.length > boundedLimit(limits, 'metadataBytes')) {
    fail('METADATA_TOO_LARGE', `${roleName} metadata exceeds the byte limit`, {
      role: roleName,
      actual: bytes.length,
      limit: boundedLimit(limits, 'metadataBytes'),
    });
  }
  if (metadata.signatures.length > boundedLimit(limits, 'signatures')) {
    fail('TOO_MANY_SIGNATURES', `${roleName} has too many signatures`);
  }
  return bytes;
}

function keyObjectFromRawEd25519(key) {
  if (!isPlainObject(key)
      || key.keytype !== POUF.signatureScheme
      || key.scheme !== POUF.signatureScheme
      || !isPlainObject(key.keyval)
      || typeof key.keyval.public !== 'string'
      || !HEX_64.test(key.keyval.public)) {
    fail('UNSUPPORTED_KEY', 'only raw Ed25519 public keys are accepted by this spike POUF');
  }

  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key.keyval.public, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

function assertRootShape(rootSigned, limits) {
  if (!isPlainObject(rootSigned.keys) || !isPlainObject(rootSigned.roles)) {
    fail('INVALID_ROOT', 'root metadata must contain keys and roles objects');
  }

  const keyEntries = Object.entries(rootSigned.keys);
  if (keyEntries.length === 0 || keyEntries.length > boundedLimit(limits, 'rootKeys')) {
    fail('INVALID_ROOT', 'root key count is outside the accepted envelope');
  }

  for (const [keyId, key] of keyEntries) {
    if (!HEX_64.test(keyId)) fail('INVALID_KEYID', `root key id is not SHA-256 hex: ${keyId}`);
    keyObjectFromRawEd25519(key);
    if (keyIdFor(key, limits) !== keyId) {
      fail('KEYID_MISMATCH', `root key id does not match its canonical key object: ${keyId}`);
    }
  }

  for (const roleName of ['root', 'targets', 'snapshot', 'timestamp']) {
    const role = rootSigned.roles[roleName];
    if (!isPlainObject(role) || !Array.isArray(role.keyids)) {
      fail('INVALID_ROOT_ROLE', `root role ${roleName} is missing`);
    }
    assertPositiveInteger(role.threshold, `${roleName}.threshold`);
    const unique = new Set(role.keyids);
    if (unique.size !== role.keyids.length) {
      fail('DUPLICATE_ROLE_KEY', `${roleName} contains duplicate key ids`);
    }
    if (role.threshold > unique.size) {
      fail('INVALID_THRESHOLD', `${roleName} threshold exceeds its key count`);
    }
    for (const keyId of unique) {
      if (!Object.hasOwn(rootSigned.keys, keyId)) {
        fail('UNKNOWN_ROLE_KEY', `${roleName} references an unknown key: ${keyId}`);
      }
    }
  }
}

function verifyRoleSignatures(metadata, trustedRootSigned, roleName, limits) {
  const role = trustedRootSigned.roles[roleName];
  if (!role) fail('UNKNOWN_ROLE', `trusted root does not define role ${roleName}`);

  if (metadata.signatures.length > boundedLimit(limits, 'signatures')) {
    fail('TOO_MANY_SIGNATURES', `${roleName} has too many signatures`);
  }

  const message = signedBytes(metadata, limits);
  const seen = new Set();
  let valid = 0;

  for (const signature of metadata.signatures) {
    if (!isPlainObject(signature)
        || typeof signature.keyid !== 'string'
        || typeof signature.sig !== 'string'
        || !HEX_128.test(signature.sig)) {
      fail('INVALID_SIGNATURE', `${roleName} contains a malformed signature`);
    }
    if (seen.has(signature.keyid)) {
      fail('DUPLICATE_SIGNATURE', `${roleName} repeats signature key ${signature.keyid}`);
    }
    seen.add(signature.keyid);

    if (!role.keyids.includes(signature.keyid)) continue;
    const key = trustedRootSigned.keys[signature.keyid];
    if (!key) continue;

    const ok = verifySignature(
      null,
      message,
      keyObjectFromRawEd25519(key),
      Buffer.from(signature.sig, 'hex'),
    );
    if (ok) valid += 1;
  }

  if (valid < role.threshold) {
    fail('SIGNATURE_THRESHOLD', `${roleName} signature threshold was not met`, {
      role: roleName,
      valid,
      threshold: role.threshold,
    });
  }
}

function sameRoleKeys(leftRoot, rightRoot, roleName) {
  const left = leftRoot.roles[roleName];
  const right = rightRoot.roles[roleName];
  if (!left || !right || left.threshold !== right.threshold) return false;
  const leftKeys = [...left.keyids].sort();
  const rightKeys = [...right.keyids].sort();
  return canonicalJson(leftKeys) === canonicalJson(rightKeys);
}

export function updateRootChain(trustedRoot, candidates, fixedStartTime, limits = DEFAULT_LIMITS) {
  if (!Array.isArray(candidates)) fail('INVALID_ROOT_CHAIN', 'root candidates must be an array');
  if (candidates.length > boundedLimit(limits, 'rootUpdates')) {
    fail('TOO_MANY_ROOT_UPDATES', 'root update chain exceeds the limit');
  }

  assertMetadataLimit(trustedRoot, limits, 'root');
  assertRoleMetadata(trustedRoot, 'root', fixedStartTime, { checkExpiry: false });
  assertRootShape(trustedRoot.signed, limits);

  let current = trustedRoot;
  let timestampKeysRotated = false;
  let snapshotKeysRotated = false;

  for (const candidate of candidates) {
    assertMetadataLimit(candidate, limits, 'root');
    assertRoleMetadata(candidate, 'root', fixedStartTime, { checkExpiry: false });
    assertRootShape(candidate.signed, limits);

    if (candidate.signed.version !== current.signed.version + 1) {
      fail('ROOT_VERSION', 'root versions must advance exactly by one', {
        trusted: current.signed.version,
        candidate: candidate.signed.version,
      });
    }

    verifyRoleSignatures(candidate, current.signed, 'root', limits);
    verifyRoleSignatures(candidate, candidate.signed, 'root', limits);

    timestampKeysRotated ||= !sameRoleKeys(current.signed, candidate.signed, 'timestamp');
    snapshotKeysRotated ||= !sameRoleKeys(current.signed, candidate.signed, 'snapshot');
    current = candidate;
  }

  assertNotExpired(current.signed.expires, fixedStartTime, 'root');
  return { root: current, timestampKeysRotated, snapshotKeysRotated };
}

function assertDigest(actual, expected, code, label) {
  if (typeof expected !== 'string' || !HEX_64.test(expected)) {
    fail('INVALID_HASH', `${label} has an invalid SHA-256 digest`);
  }
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    fail(code, `${label} SHA-256 mismatch`, { actual, expected });
  }
}

function verifyMetadataDescriptor(metadata, descriptor, label, limits, rawBytes = undefined) {
  if (!isPlainObject(descriptor)
      || !Number.isSafeInteger(descriptor.length)
      || descriptor.length < 0
      || !isPlainObject(descriptor.hashes)
      || !Number.isSafeInteger(descriptor.version)
      || descriptor.version < 1) {
    fail('INVALID_META_DESCRIPTOR', `${label} descriptor is invalid`);
  }

  // TUF metadata-file descriptors bind the file bytes, not a canonicalized
  // reconstruction of the envelope. Signature verification remains over the
  // canonical form of metadata.signed.
  const bytes = assertMetadataLimit(metadata, limits, label, rawBytes);
  if (bytes.length !== descriptor.length) {
    fail('METADATA_LENGTH', `${label} length mismatch`, {
      actual: bytes.length,
      expected: descriptor.length,
    });
  }
  assertDigest(sha256(bytes), descriptor.hashes.sha256, 'METADATA_HASH', label);
}

function validateTargetPath(targetPath, limits) {
  assertStringWellFormed(targetPath, 'target path');
  const components = targetPath.split('/');
  if (targetPath.length === 0
      || targetPath.length > boundedLimit(limits, 'targetPathLength')
      || components.length > boundedLimit(limits, 'targetPathComponents')
      || targetPath.startsWith('/')
      || targetPath.includes('\\')
      || targetPath.includes('\0')
      || components.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail('INVALID_TARGET_PATH', `unsafe target path: ${targetPath}`);
  }
}

function normalizeCapabilities(value, limits) {
  if (!Array.isArray(value) || value.length > boundedLimit(limits, 'capabilities')) {
    fail('INVALID_CAPABILITIES', 'capabilities must be a bounded array');
  }
  const result = [];
  const seen = new Set();
  for (const capability of value) {
    assertStringWellFormed(capability, 'capability');
    if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(capability)) {
      fail('INVALID_CAPABILITIES', `invalid capability identifier: ${capability}`);
    }
    if (seen.has(capability)) fail('INVALID_CAPABILITIES', `duplicate capability: ${capability}`);
    seen.add(capability);
    result.push(capability);
  }
  return result.sort();
}

function verifyTargetDescriptor(target, descriptor, limits) {
  if (!Buffer.isBuffer(target.bytes)) fail('INVALID_TARGET', 'target bytes must be a Buffer');
  if (target.bytes.length > boundedLimit(limits, 'targetBytes')) {
    fail('TARGET_TOO_LARGE', 'target exceeds the configured byte limit');
  }
  if (!isPlainObject(descriptor)
      || !Number.isSafeInteger(descriptor.length)
      || descriptor.length < 0
      || !isPlainObject(descriptor.hashes)
      || !isPlainObject(descriptor.custom)) {
    fail('INVALID_TARGET_DESCRIPTOR', 'target descriptor is invalid');
  }
  if (target.bytes.length !== descriptor.length) {
    fail('TARGET_LENGTH', 'target length mismatch', {
      actual: target.bytes.length,
      expected: descriptor.length,
    });
  }
  assertDigest(sha256(target.bytes), descriptor.hashes.sha256, 'TARGET_HASH', 'target');
}

function assertTimestampMetaMap(timestamp) {
  if (!isPlainObject(timestamp.signed.meta)) {
    fail('INVALID_TIMESTAMP', 'timestamp meta must be an object');
  }
  const metaPaths = Object.keys(timestamp.signed.meta);
  if (metaPaths.length !== 1 || metaPaths[0] !== 'snapshot.json') {
    fail('INVALID_TIMESTAMP_META', 'timestamp meta must describe exactly snapshot.json');
  }
  return timestamp.signed.meta;
}

function assertMetaMap(snapshot, limits) {
  if (!isPlainObject(snapshot.signed.meta)) fail('INVALID_SNAPSHOT', 'snapshot meta must be an object');
  const entries = Object.entries(snapshot.signed.meta);
  if (entries.length === 0 || entries.length > boundedLimit(limits, 'targetCount')) {
    fail('INVALID_SNAPSHOT', 'snapshot metadata count is outside the accepted envelope');
  }

  // Delegated targets are deliberately unsupported by the current POUF. Reject
  // extra metadata names instead of silently ignoring state that would acquire
  // security meaning once delegation traversal is implemented.
  if (entries.length !== 1 || entries[0][0] !== 'targets.json') {
    fail('UNSUPPORTED_SNAPSHOT_META', 'top-level-only POUF accepts exactly targets.json');
  }
  return snapshot.signed.meta;
}

function currentTrustedVersion(trustedState, roleName) {
  const value = trustedState.versions?.[roleName] ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_TRUSTED_STATE', `trusted ${roleName} version is invalid`);
  }
  return value;
}

function trustedSnapshotTargetVersion(trustedState) {
  const value = trustedState.snapshotMeta?.['targets.json']?.version ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_TRUSTED_STATE', 'trusted snapshot targets version is invalid');
  }
  return value;
}

/**
 * Verify a self-contained offline update bundle.
 *
 * This performs cryptographic and monotonicity checks in memory. Atomic durable
 * persistence is deliberately returned as a proposed next state and is not claimed
 * by this spike.
 */
export function verifyTopLevelMetadata({
  trustedState,
  bundle,
  now = new Date(),
  limits = DEFAULT_LIMITS,
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    fail('INVALID_TIME', 'now must be a valid Date');
  }
  if (!isPlainObject(trustedState) || !isPlainObject(bundle)) {
    fail('INVALID_INPUT', 'trusted state and bundle must be objects');
  }
  if (bundle.rawMetadata !== undefined && !isPlainObject(bundle.rawMetadata)) {
    fail('INVALID_RAW_METADATA', 'bundle.rawMetadata must be an object when provided');
  }

  const rawMetadata = bundle.rawMetadata;
  if (rawMetadata?.roots !== undefined) {
    if (!Array.isArray(rawMetadata.roots) || rawMetadata.roots.length !== (bundle.roots ?? []).length) {
      fail('INVALID_RAW_METADATA', 'raw root metadata must align one-to-one with root candidates');
    }
    for (let index = 0; index < rawMetadata.roots.length; index += 1) {
      assertMetadataLimit(bundle.roots[index], limits, 'root', rawMetadata.roots[index]);
    }
  }

  const rootUpdate = updateRootChain(trustedState.root, bundle.roots ?? [], now, limits);
  const trustedRoot = rootUpdate.root;

  const metadataRollbackStateReset = rootUpdate.timestampKeysRotated || rootUpdate.snapshotKeysRotated;
  const trustedTimestampVersion = metadataRollbackStateReset
    ? 0
    : currentTrustedVersion(trustedState, 'timestamp');
  const trustedSnapshotVersion = metadataRollbackStateReset
    ? 0
    : currentTrustedVersion(trustedState, 'snapshot');
  const trustedTargetsVersion = currentTrustedVersion(trustedState, 'targets');

  assertMetadataLimit(bundle.timestamp, limits, 'timestamp', rawMetadata?.timestamp);
  assertRoleMetadata(bundle.timestamp, 'timestamp', now, { checkExpiry: false });
  verifyRoleSignatures(bundle.timestamp, trustedRoot.signed, 'timestamp', limits);

  const timestampVersion = bundle.timestamp.signed.version;
  if (timestampVersion < trustedTimestampVersion) {
    fail('TIMESTAMP_ROLLBACK', 'timestamp version rolled back');
  }
  if (timestampVersion === trustedTimestampVersion && trustedTimestampVersion !== 0) {
    return {
      status: 'no-update',
      trustedState: {
        ...trustedState,
        root: trustedRoot,
      },
      rootUpdated: trustedRoot.signed.version !== trustedState.root.signed.version,
    };
  }

  assertNotExpired(bundle.timestamp.signed.expires, now, 'timestamp');

  const timestampMeta = assertTimestampMetaMap(bundle.timestamp);
  const snapshotDescriptor = timestampMeta['snapshot.json'];
  if (snapshotDescriptor.version < trustedSnapshotVersion) {
    fail('SNAPSHOT_ROLLBACK', 'timestamp points to an older snapshot version');
  }

  verifyMetadataDescriptor(bundle.snapshot, snapshotDescriptor, 'snapshot', limits, rawMetadata?.snapshot);
  assertRoleMetadata(bundle.snapshot, 'snapshot', now, { checkExpiry: false });
  verifyRoleSignatures(bundle.snapshot, trustedRoot.signed, 'snapshot', limits);
  if (bundle.snapshot.signed.version !== snapshotDescriptor.version) {
    fail('SNAPSHOT_VERSION', 'snapshot version does not match timestamp metadata');
  }

  assertNotExpired(bundle.snapshot.signed.expires, now, 'snapshot');

  const snapshotMeta = assertMetaMap(bundle.snapshot, limits);
  const targetsDescriptor = snapshotMeta['targets.json'];

  const oldTargetsVersion = metadataRollbackStateReset
    ? trustedTargetsVersion
    : Math.max(trustedTargetsVersion, trustedSnapshotTargetVersion(trustedState));
  if (targetsDescriptor.version < oldTargetsVersion) {
    fail('TARGETS_ROLLBACK', 'snapshot points to an older targets version');
  }

  verifyMetadataDescriptor(bundle.targets, targetsDescriptor, 'targets', limits, rawMetadata?.targets);
  assertRoleMetadata(bundle.targets, 'targets', now, { checkExpiry: false });
  verifyRoleSignatures(bundle.targets, trustedRoot.signed, 'targets', limits);
  if (bundle.targets.signed.version !== targetsDescriptor.version) {
    fail('TARGETS_VERSION', 'targets version does not match snapshot metadata');
  }

  assertNotExpired(bundle.targets.signed.expires, now, 'targets');

  if (!isPlainObject(bundle.targets.signed.targets)) {
    fail('INVALID_TARGETS', 'targets metadata must contain a targets object');
  }
  const targetEntries = Object.keys(bundle.targets.signed.targets);
  if (targetEntries.length > boundedLimit(limits, 'targetCount')) {
    fail('TOO_MANY_TARGETS', 'targets metadata exceeds the entry limit');
  }
  for (const entryPath of targetEntries) validateTargetPath(entryPath, limits);

  return {
    status: 'metadata-verified',
    trustedRoot,
    timestampVersion,
    snapshotVersion: bundle.snapshot.signed.version,
    targetsVersion: bundle.targets.signed.version,
    snapshotMeta,
    targets: bundle.targets,
    metadataRollbackStateReset,
  };
}

/**
 * Verify a self-contained offline Browser update bundle.
 *
 * Generic top-level TUF verification is performed by verifyTopLevelMetadata().
 * Browser-specific application identity, target and capability policy is layered
 * on only after the generic metadata chain is accepted.
 */
export function verifyOfflineBundle({
  trustedState,
  bundle,
  targetPath,
  now = new Date(),
  approveCapabilityExpansion = () => false,
  limits = DEFAULT_LIMITS,
}) {
  validateTargetPath(targetPath, limits);

  const metadataResult = verifyTopLevelMetadata({
    trustedState,
    bundle,
    now,
    limits,
  });
  if (metadataResult.status === 'no-update') return metadataResult;

  const {
    trustedRoot,
    timestampVersion,
    snapshotMeta,
  } = metadataResult;

  const descriptor = bundle.targets.signed.targets[targetPath];
  if (!descriptor) fail('TARGET_NOT_FOUND', `target is not authorized: ${targetPath}`);
  if (!isPlainObject(bundle.target) || bundle.target.path !== targetPath) {
    fail('WRONG_TARGET', 'offline bundle target path does not match the requested target');
  }
  if (trustedState.app?.targetPath && trustedState.app.targetPath !== targetPath) {
    fail('TARGET_PATH_MISMATCH', 'target path does not match trusted application state');
  }
  verifyTargetDescriptor(bundle.target, descriptor, limits);

  const appId = descriptor.custom.app_id;
  const appVersion = descriptor.custom.app_version;
  const capabilities = normalizeCapabilities(descriptor.custom.capabilities, limits);
  assertStringWellFormed(appId, 'app_id');
  assertPositiveInteger(appVersion, 'app_version');

  if (trustedState.app?.appId && appId !== trustedState.app.appId) {
    fail('APP_ID_MISMATCH', 'target app identity does not match trusted state');
  }

  const previousAppVersion = trustedState.app?.version ?? 0;
  if (!Number.isSafeInteger(previousAppVersion) || previousAppVersion < 0) {
    fail('INVALID_TRUSTED_STATE', 'trusted app version is invalid');
  }
  if (appVersion < previousAppVersion) {
    fail('APP_ROLLBACK', 'target app version rolled back');
  }

  const previousCapabilities = normalizeCapabilities(trustedState.app?.capabilities ?? [], limits);
  const previousDigest = trustedState.app?.digest;
  const digest = descriptor.hashes.sha256;
  if (appVersion === previousAppVersion) {
    const sameCapabilities = canonicalJson(capabilities) === canonicalJson(previousCapabilities);
    if ((previousDigest && digest !== previousDigest) || !sameCapabilities) {
      fail('APP_VERSION_REUSE', 'an app version was reused for different identity or capabilities');
    }
  }

  const expansion = capabilities.filter((capability) => !previousCapabilities.includes(capability));
  if (expansion.length > 0) {
    const approved = approveCapabilityExpansion({
      appId,
      fromVersion: previousAppVersion,
      toVersion: appVersion,
      previousCapabilities,
      capabilities,
      expansion,
    });
    if (approved !== true) {
      fail('CAPABILITY_ESCALATION', 'update expands capabilities without explicit approval', { expansion });
    }
  }

  const nextState = {
    root: trustedRoot,
    versions: {
      timestamp: timestampVersion,
      snapshot: bundle.snapshot.signed.version,
      targets: bundle.targets.signed.version,
    },
    snapshotMeta,
    app: {
      appId,
      version: appVersion,
      capabilities,
      targetPath,
      digest,
    },
    decision: {
      verifiedAt: now.toISOString(),
      rootVersion: trustedRoot.signed.version,
      timestampVersion,
      snapshotVersion: bundle.snapshot.signed.version,
      targetsVersion: bundle.targets.signed.version,
      targetPath,
      targetDigest: digest,
    },
  };

  return {
    status: appVersion === previousAppVersion ? 'metadata-updated' : 'update-verified',
    target: bundle.target.bytes,
    nextState,
    persistenceRequired: true,
  };
}
