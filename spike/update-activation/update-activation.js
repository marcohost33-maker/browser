// Coupled update transaction (ADR-009 "atomic metadata/package activation").
//
// Trusted TUF metadata and the active package move in ONE activation-store commit:
// the four role files and the app trust state are commit-level bindings of the same
// `state/CURRENT` rename that names the active version. There is no window in which
// new metadata sits next to an old package or the other way round, and no window in
// which root.json and timestamp.json come from different updates. Two special cases
// of the role-by-role client (`client/client-core.mjs`) disappear by construction:
// the TUF 5.3.11 rotation reset on load and the resume from a trusted timestamp
// after a crash between role files. A bound chain that does not verify is therefore
// never a crash artefact; it is damage or tampering and fails closed.
//
// Policy stays where it is: the generic TUF core and the Browser app/capability
// policy of `verifyOfflineBundleBytes` decide; the activation store only persists.
// The package is staged as one opaque, content-addressed object (container-as-store-
// object, storage mode B of the #24 bake-off plan) because the container format is
// still open (register D4).

import { canonicalBytes, parseCanonicalRecord, sha256Hex } from '../activation-store/activation-store.js';
import { DEFAULT_LIMITS, verifyBootstrapRoot } from '../tuf-offline-metadata/tuf-offline.js';
import {
  parseTufMetadataBytes,
  verifyOfflineBundleBytes,
  verifyTopLevelMetadataBytes,
} from '../tuf-offline-metadata/strict-json.js';

export const UPDATE_BINDINGS = Object.freeze({
  root: 'update/root',
  timestamp: 'update/timestamp',
  snapshot: 'update/snapshot',
  targets: 'update/targets',
  trustState: 'update/trust-state',
});
const CHAIN_ROLES = Object.freeze(['timestamp', 'snapshot', 'targets', 'trustState']);
const UPDATE_BINDING_NAMES = Object.freeze(new Set(Object.values(UPDATE_BINDINGS)));

export const TARGET_RECORD_BINDING = 'update/target';
export const PACKAGE_RESOURCE = 'package';
export const PACKAGE_MEDIA_TYPE = 'application/octet-stream';
export const TRUST_STATE_SCHEMA = 'browser-update-activation/trust-state/v1';
export const TARGET_RECORD_SCHEMA = 'browser-update-activation/target/v1';

// Bound metadata is checked for authenticity and internal consistency, never for
// freshness: an installed application must keep starting offline after its update
// metadata expired (ADR-009 disabled-update mode). With the epoch as the evaluation
// time every expiry check passes, while every signature threshold, role, spec version,
// version pin and length/hash pin of the generic verifier is still enforced.
const FRESHNESS_NOT_EVALUATED = new Date(0);

export class UpdateActivationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'UpdateActivationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new UpdateActivationError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Intrinsic TypedArray byteLength: an own `length`/`byteLength` property on the
// caller's view cannot misreport the size that a gate checks.
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
).get;

function positiveLimit(limits, name) {
  const value = limits?.[name] ?? DEFAULT_LIMITS[name];
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_ARGUMENT', `${name} must be a positive safe integer`);
  return value;
}

// A private copy, made only after the size gate: an oversized input is refused
// before a single byte of it is copied.
function privateBytes(value, label, maxBytes = Number.MAX_SAFE_INTEGER, code = 'INVALID_ARGUMENT') {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
    fail('INVALID_ARGUMENT', `${label} must be Buffer or Uint8Array`);
  }
  const byteLength = Reflect.apply(typedArrayByteLength, value, []);
  if (byteLength > maxBytes) fail(code, `${label} exceeds the byte limit`, { actual: byteLength, limit: maxBytes });
  const copy = Buffer.alloc(byteLength);
  copy.set(value);
  return copy;
}

function blob(bytes) {
  return { digest: sha256Hex(bytes), size: bytes.length, bytes };
}

function sameJson(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

// Bindings that belong to someone else are carried forward by reference, unchanged.
function foreignBindingReferences(bindings) {
  return Object.fromEntries(Object.entries(bindings)
    .filter(([name]) => !UPDATE_BINDING_NAMES.has(name))
    .map(([name, entry]) => [name, { digest: entry.digest, size: entry.size }]));
}

function invalidState(message, cause, details = {}) {
  fail('UPDATE_STATE_INVALID', message, { ...details, cause: cause?.code ?? String(cause) });
}

// ------------------------------------------------------------------ records

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    fail('UPDATE_STATE_INVALID', `${label} has an unexpected shape`);
  }
}

function assertCapabilityList(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')
      || value.some((item, index) => index > 0 && value[index - 1] >= item)) {
    fail('UPDATE_STATE_INVALID', `${label} must be a sorted list of unique strings`);
  }
}

function assertAppRecord(app, label) {
  assertExactKeys(app, ['appId', 'capabilities', 'digest', 'targetPath', 'version'], label);
  if (typeof app.appId !== 'string' || app.appId.length === 0
      || typeof app.targetPath !== 'string' || app.targetPath.length === 0
      || !Number.isSafeInteger(app.version) || app.version < 1
      || typeof app.digest !== 'string' || !/^[0-9a-f]{64}$/.test(app.digest)) {
    fail('UPDATE_STATE_INVALID', `${label} fields are invalid`);
  }
  assertCapabilityList(app.capabilities, `${label}.capabilities`);
}

function parseTrustState(bytes) {
  let record;
  try {
    record = parseCanonicalRecord(bytes);
  } catch (error) {
    invalidState('trust state is not a canonical record', error);
  }
  assertExactKeys(record, ['app', 'decision', 'schema'], 'trust state');
  if (record.schema !== TRUST_STATE_SCHEMA) fail('UPDATE_STATE_INVALID', 'trust state has an unknown schema');
  assertAppRecord(record.app, 'trust state app');
  if (!isPlainObject(record.decision)) fail('UPDATE_STATE_INVALID', 'trust state decision must be an object');
  return record;
}

function targetRecordFor(app, length) {
  return {
    schema: TARGET_RECORD_SCHEMA,
    appId: app.appId,
    appVersion: app.version,
    capabilities: app.capabilities,
    length,
    sha256: app.digest,
    targetPath: app.targetPath,
  };
}

function parseTargetRecord(bytes) {
  let record;
  try {
    record = parseCanonicalRecord(bytes);
  } catch (error) {
    fail('ACTIVE_VERSION_INVALID', 'target record is not a canonical record', { cause: error?.code });
  }
  try {
    assertExactKeys(record, ['appId', 'appVersion', 'capabilities', 'length', 'schema', 'sha256', 'targetPath'], 'target record');
    if (record.schema !== TARGET_RECORD_SCHEMA) fail('UPDATE_STATE_INVALID', 'target record has an unknown schema');
    if (!Number.isSafeInteger(record.length) || record.length < 0) fail('UPDATE_STATE_INVALID', 'target record length is invalid');
    assertAppRecord({
      appId: record.appId,
      capabilities: record.capabilities,
      digest: record.sha256,
      targetPath: record.targetPath,
      version: record.appVersion,
    }, 'target record');
  } catch (error) {
    if (!(error instanceof UpdateActivationError)) throw error;
    fail('ACTIVE_VERSION_INVALID', `target record is invalid: ${error.message}`);
  }
  return record;
}

// ---------------------------------------------------------------- bound chain

/**
 * Verifies a bound timestamp/snapshot/targets chain under `root` with the generic
 * TUF core: signatures and thresholds, roles, spec version, the timestamp->snapshot
 * and snapshot->targets version/length/hash pins over the exact bound bytes, and
 * every signed target path. Freshness is deliberately not evaluated (see above).
 */
function verifyBoundChain(root, raw, limits) {
  return verifyTopLevelMetadataBytes({
    trustedState: { root, versions: { timestamp: 0, snapshot: 0, targets: 0 }, snapshotMeta: {} },
    bundle: { roots: [], timestamp: raw.timestamp, snapshot: raw.snapshot, targets: raw.targets },
    now: FRESHNESS_NOT_EVALUATED,
    limits,
  });
}

// The trust state must describe a target that the bound targets metadata authorises.
function assertTrustStateAuthorised(app, targets) {
  const entry = targets.signed.targets[app.targetPath];
  const custom = entry?.custom;
  const capabilities = Array.isArray(custom?.capabilities) ? [...custom.capabilities].sort() : null;
  if (!isPlainObject(entry) || entry.hashes?.sha256 !== app.digest
      || custom?.app_id !== app.appId || custom?.app_version !== app.version
      || capabilities === null || !sameJson(capabilities, app.capabilities)) {
    fail('UPDATE_STATE_INVALID', 'trust state is not authorised by the bound targets metadata');
  }
}

/**
 * Loads and re-verifies the update state of the current commit. Every bound role is
 * re-parsed from its exact bytes; nothing is trusted because it was written earlier.
 * Returns the TUF trusted state the next update is verified against (its versions are
 * the rollback floors), the app trust state and the commit it was read from.
 */
export async function loadUpdateState(store, { limits = DEFAULT_LIMITS } = {}) {
  const commit = await store.readCommitBindings();
  const raw = Object.fromEntries(Object.entries(UPDATE_BINDINGS)
    .map(([role, name]) => [role, commit.bindings[name]?.bytes ?? null]));
  const present = CHAIN_ROLES.filter((role) => raw[role] !== null);
  if (raw.root === null) {
    if (present.length > 0) fail('UPDATE_STATE_INVALID', 'update metadata is bound without a trusted root');
    fail('UPDATE_TRUST_MISSING', 'no trusted root is bound; bootstrap update trust first');
  }
  if (present.length !== 0 && present.length !== CHAIN_ROLES.length) {
    fail('UPDATE_STATE_INVALID', 'bound update metadata is incomplete', { present });
  }

  let root;
  try {
    root = verifyBootstrapRoot(parseTufMetadataBytes(raw.root, limits, 'bound-root'), limits);
  } catch (error) {
    invalidState('bound root does not verify', error, { role: 'root' });
  }

  const base = {
    generation: commit.generation,
    active: commit.active,
    previous: commit.previous,
    raw,
    foreignBindings: foreignBindingReferences(commit.bindings),
  };
  if (present.length === 0) {
    return {
      ...base,
      trustedState: { root, versions: { timestamp: 0, snapshot: 0, targets: 0 }, snapshotMeta: {} },
      app: null,
      decision: null,
    };
  }

  let chain;
  try {
    chain = verifyBoundChain(root, raw, limits);
  } catch (error) {
    invalidState('bound update metadata does not verify under the bound root', error);
  }
  const trustState = parseTrustState(raw.trustState);
  assertTrustStateAuthorised(trustState.app, chain.targets);
  return {
    ...base,
    trustedState: {
      root,
      versions: { timestamp: chain.timestampVersion, snapshot: chain.snapshotVersion, targets: chain.targetsVersion },
      snapshotMeta: chain.snapshotMeta,
    },
    app: trustState.app,
    decision: trustState.decision,
  };
}

// ------------------------------------------------------------------ operations

/**
 * Binds the initial trusted root (TUF 5.2) into a store that holds no update trust
 * yet. Re-bootstrapping over existing trust is refused rather than merged: a new
 * root next to old rollback floors would mix two trust domains.
 */
export async function bootstrapUpdateTrust(store, rootBytes, { limits = DEFAULT_LIMITS } = {}) {
  const bytes = privateBytes(rootBytes, 'root bytes');
  const status = await store.status();
  const existing = Object.keys(status.bindings).filter((name) => UPDATE_BINDING_NAMES.has(name));
  if (existing.length > 0) fail('UPDATE_TRUST_EXISTS', 'update trust is already bootstrapped', { existing });
  verifyBootstrapRoot(parseTufMetadataBytes(bytes, limits, 'trusted-root'), limits);
  return store.commitBindings(
    { ...foreignBindingReferences(status.bindings), [UPDATE_BINDINGS.root]: blob(bytes) },
    { expectedGeneration: status.generation },
  );
}

function bundleCopies(bundle, limits) {
  if (!isPlainObject(bundle)) fail('INVALID_ARGUMENT', 'bundle must be an object');
  const roots = bundle.roots ?? [];
  if (!Array.isArray(roots)) fail('INVALID_ARGUMENT', 'bundle.roots must be an array');
  if (!isPlainObject(bundle.target)) fail('INVALID_ARGUMENT', 'bundle.target must be an object');
  // Count and size gates run before any copy, with the verifier's limits and error
  // codes, so an untrusted bundle costs at most what the verifier would accept.
  const rootUpdates = positiveLimit(limits, 'rootUpdates');
  if (roots.length > rootUpdates) {
    fail('TOO_MANY_ROOT_UPDATES', 'root update chain exceeds the limit', { actual: roots.length, limit: rootUpdates });
  }
  const metadataBytes = positiveLimit(limits, 'metadataBytes');
  const metadata = (value, label) => privateBytes(value, label, metadataBytes, 'METADATA_TOO_LARGE');
  // One private copy of every input is verified AND bound: a caller mutating its
  // buffers after the call started can change neither what is checked nor what is
  // committed.
  return {
    roots: Array.from(roots, (bytes, index) => metadata(bytes, `bundle.roots[${index}]`)),
    timestamp: metadata(bundle.timestamp, 'bundle.timestamp'),
    snapshot: metadata(bundle.snapshot, 'bundle.snapshot'),
    targets: metadata(bundle.targets, 'bundle.targets'),
    target: {
      path: bundle.target.path,
      bytes: privateBytes(bundle.target.bytes, 'bundle.target.bytes', positiveLimit(limits, 'targetBytes'), 'TARGET_TOO_LARGE'),
    },
  };
}

function updateBindings(state, { root, timestamp, snapshot, targets, trustState }) {
  return {
    ...state.foreignBindings,
    [UPDATE_BINDINGS.root]: blob(root),
    [UPDATE_BINDINGS.timestamp]: blob(timestamp),
    [UPDATE_BINDINGS.snapshot]: blob(snapshot),
    [UPDATE_BINDINGS.targets]: blob(targets),
    [UPDATE_BINDINGS.trustState]: blob(trustState),
  };
}

function trustStateBytes(nextState) {
  return canonicalBytes({ schema: TRUST_STATE_SCHEMA, app: nextState.app, decision: nextState.decision });
}

/**
 * Verifies one self-contained offline update bundle against the bound state of the
 * current commit and returns what a single transaction must write. Nothing is
 * written here. `kind` is one of:
 *
 * - `activate`: a new app version. Stage `stage` (the verified package bytes as one
 *   store object plus its target record), then ONE `activate` that names the new
 *   version and binds `bindings` (root, timestamp, snapshot, targets, trust state);
 * - `bind`: same app version and bytes, newer metadata. ONE `commitBindings`; the
 *   active version is not touched, so a local rollback stays in force;
 * - `root-only`: unchanged timestamp but a newer root. The bound chain must still
 *   verify under it; ONE `commitBindings` that changes only the root;
 * - `none`: nothing to write.
 *
 * Every write uses compare-and-swap on `state.generation`, the generation the plan
 * was verified against.
 */
export async function planOfflineUpdate(store, {
  bundle,
  targetPath,
  now = new Date(),
  approveCapabilityExpansion = () => false,
  limits = DEFAULT_LIMITS,
} = {}) {
  const copies = bundleCopies(bundle, limits);
  const state = await loadUpdateState(store, { limits });
  const result = verifyOfflineBundleBytes({
    trustedState: state.app === null ? state.trustedState : { ...state.trustedState, app: state.app },
    bundle: copies,
    targetPath,
    now,
    approveCapabilityExpansion,
    limits,
  });
  const root = copies.roots.length > 0 ? copies.roots.at(-1) : state.raw.root;

  if (result.status === 'no-update') {
    if (!result.rootUpdated) return { kind: 'none', state };
    try {
      verifyBoundChain(result.trustedState.root, state.raw, limits);
    } catch (error) {
      fail('RETAINED_METADATA_INVALID', 'bound metadata does not verify under the newer root; publish a new timestamp', {
        cause: error?.code,
      });
    }
    return {
      kind: 'root-only',
      state,
      bindings: {
        ...state.foreignBindings,
        [UPDATE_BINDINGS.root]: blob(root),
        ...Object.fromEntries(CHAIN_ROLES.map((role) => [UPDATE_BINDINGS[role], blob(state.raw[role])])),
      },
    };
  }

  const bindings = updateBindings(state, {
    root,
    timestamp: copies.timestamp,
    snapshot: copies.snapshot,
    targets: copies.targets,
    trustState: trustStateBytes(result.nextState),
  });
  const decision = result.nextState.decision;
  if (result.status === 'metadata-updated') return { kind: 'bind', state, bindings, decision };

  // `result.target` is the verifier's private copy: exactly the bytes that were hashed.
  const app = result.nextState.app;
  const record = canonicalBytes(targetRecordFor(app, result.target.length));
  return {
    kind: 'activate',
    state,
    bindings,
    decision,
    stage: {
      appVersion: String(app.version),
      packageDigest: app.digest,
      resources: [{
        path: PACKAGE_RESOURCE,
        mediaType: PACKAGE_MEDIA_TYPE,
        digest: app.digest,
        size: result.target.length,
        bytes: result.target,
      }],
      bindings: { [TARGET_RECORD_BINDING]: blob(record) },
    },
  };
}

/**
 * Applies one self-contained offline update bundle as a single transaction
 * (`planOfflineUpdate`, then exactly one commit). A crash anywhere leaves the commit
 * of the planned generation G or of G + 1, never a mixture; a concurrent writer
 * makes the commit fail with GENERATION_CONFLICT instead of overwriting its state.
 * Staging before the commit only adds unreferenced objects, which recovery collects.
 */
export async function applyOfflineUpdate(store, options = {}) {
  const plan = await planOfflineUpdate(store, options);
  const expectedGeneration = plan.state.generation;
  if (plan.kind === 'none') return { status: 'no-update', committed: false, generation: expectedGeneration };
  if (plan.kind === 'root-only' || plan.kind === 'bind') {
    const committed = await store.commitBindings(plan.bindings, { expectedGeneration });
    return {
      status: plan.kind === 'bind' ? 'metadata-updated' : 'root-updated',
      committed: true,
      generation: committed.generation,
      active: committed.active,
      ...(plan.decision ? { decision: plan.decision } : {}),
    };
  }
  const { versionId } = await store.stageVersion(plan.stage);
  const committed = await store.activate(versionId, { expectedGeneration, bindings: plan.bindings });
  return {
    status: 'activated',
    committed: true,
    generation: committed.generation,
    active: committed.active,
    previous: committed.previous,
    versionId,
    decision: plan.decision,
  };
}

/**
 * Local rollback to the last-good package. The store carries every commit binding
 * forward, so the update metadata and the app trust state, and with them every
 * rollback floor, stay where they are: a rollback is an owner decision about which
 * verified package runs, never a downgrade of what the client has seen.
 */
export async function rollbackPackage(store, { expectedGeneration } = {}) {
  const generation = expectedGeneration ?? (await store.status()).generation;
  return store.rollback({ expectedGeneration: generation });
}

/**
 * Start-up check without network and without freshness: the bound update state must
 * re-verify (see `loadUpdateState`) and the active version must be a package that
 * this state authorised, either the current one or an older one reached by a local
 * rollback. Returns the identity and the approved capabilities of what may run.
 */
export async function verifyInstalledState(store, { limits = DEFAULT_LIMITS } = {}) {
  const state = await loadUpdateState(store, { limits });
  const versions = { root: state.trustedState.root.signed.version, ...state.trustedState.versions };
  if (state.active === null) return { status: 'not-installed', generation: state.generation, metadataVersions: versions };
  if (state.app === null) fail('UPDATE_STATE_INVALID', 'a package is active without bound update metadata');

  const integrity = await store.verifyVersion(state.active);
  if (!integrity.ok) fail('ACTIVE_VERSION_INVALID', 'active version failed verification', { problems: integrity.problems });
  const versionRecord = await store.readVersion(state.active);
  const bound = await store.readVersionBindings(state.active);
  if (bound[TARGET_RECORD_BINDING] === undefined) fail('ACTIVE_VERSION_INVALID', 'active version carries no target record');
  const target = parseTargetRecord(bound[TARGET_RECORD_BINDING].bytes);
  const resource = versionRecord.resources.find((entry) => entry.path === PACKAGE_RESOURCE);
  if (versionRecord.resources.length !== 1 || resource === undefined
      || resource.digest !== target.sha256 || resource.size !== target.length
      || versionRecord.packageDigest !== target.sha256 || versionRecord.appVersion !== String(target.appVersion)) {
    fail('ACTIVE_VERSION_INVALID', 'active version does not match its target record');
  }
  if (target.appId !== state.app.appId) fail('ACTIVE_APP_MISMATCH', 'active package belongs to another application');

  const current = target.appVersion === state.app.version && target.sha256 === state.app.digest;
  if (!current && !(target.appVersion < state.app.version)) {
    fail('ACTIVE_VERSION_UNAUTHORIZED', 'active package is neither the trusted version nor an older rollback target', {
      active: target.appVersion,
      trusted: state.app.version,
    });
  }
  return {
    status: current ? 'current' : 'rolled-back',
    generation: state.generation,
    active: state.active,
    appId: target.appId,
    appVersion: target.appVersion,
    capabilities: target.capabilities,
    packageDigest: target.sha256,
    trustedAppVersion: state.app.version,
    metadataVersions: versions,
  };
}
