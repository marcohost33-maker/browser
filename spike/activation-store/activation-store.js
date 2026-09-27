// Format-neutral activation store for ADR-007a section 6 (filesystem and activation).
//
// The store never materialises package-supplied paths on disk. Payload bytes are kept
// as immutable content-addressed objects; package paths exist only as keys of a
// content-addressed version record. The single commit point is `state/CURRENT`,
// replaced by an atomic same-directory rename after every object it references is
// durable. Retention and garbage collection are derived from that commit record only,
// never from file-name ordering (lesson of the CWAP v0.1.1 cross-family review).

import { createHash, randomBytes } from 'node:crypto';
import { hostname as osHostname } from 'node:os';

import { createNodeIo } from './node-io.js';

export const ACTIVATION_SCHEMA = Object.freeze({
  store: 'browser-activation/store/v1',
  version: 'browser-activation/version/v1',
  commit: 'browser-activation/commit/v1',
  lock: 'browser-activation/lock/v1',
});

export const DEFAULT_ACTIVATION_LIMITS = Object.freeze({
  resources: 10_000,
  resourceBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  pathBytes: 1_024,
  pathComponents: 64,
  bindings: 64,
  bindingBytes: 16 * 1024 * 1024,
  recordBytes: 8 * 1024 * 1024,
  jsonDepth: 8,
  jsonNodes: 250_000,
});

export const COMMIT_REASONS = Object.freeze(['activate', 'rollback', 'bind']);
export const LOCK_BREAK_POLICIES = Object.freeze(['never', 'if-provably-stale', 'force']);

const HEX_64 = /^[0-9a-f]{64}$/;
const OBJECT_FANOUT = /^[0-9a-f]{2}$/;
const OBJECT_NAME = /^[0-9a-f]{62}$/;
const VISIBLE_ASCII = /^[\x21-\x7e]+$/;
const BINDING_NAME = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(?:;charset=utf-8)?$/;
// Characters that make a resource key ambiguous as a URL path or across tooling.
const PATH_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\\?#%]/u;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
// Filesystem errors that mean "this entry is not a readable regular file of acceptable
// size". They are mapped to deterministic store codes instead of escaping raw.
const UNREADABLE_ENTRY = new Set(['EFBIG', 'ELOOP', 'EISDIR', 'ENOTDIR']);
const STORE_DIRECTORIES = Object.freeze(['objects', 'tmp', 'state']);

const OBJECT_MODE = 0o444;
const PRIVATE_FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const LOCK_MAX_BYTES = 4 * 1024;
const MARKER_MAX_BYTES = 4 * 1024;
const STORE_ID_MAX_LENGTH = 256;
const APP_VERSION_MAX_LENGTH = 128;
const BINDING_NAME_MAX_LENGTH = 128;

export class ActivationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ActivationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ActivationError(code, message, details);
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function ioErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : undefined;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, required, optional, label) {
  if (!isPlainObject(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('INVALID_ARGUMENT', `${label} has unexpected field ${JSON.stringify(key)}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('INVALID_ARGUMENT', `${label} is missing field ${key}`);
  }
}

function assertDigest(value, label, code = 'INVALID_ARGUMENT') {
  if (typeof value !== 'string' || !HEX_64.test(value)) {
    fail(code, `${label} must be a lowercase hex SHA-256 digest`);
  }
}

function assertSize(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_ARGUMENT', `${label} must be a non-negative safe integer`);
  if (value > max) fail('LIMIT_EXCEEDED', `${label} exceeds the configured limit`, { value, max });
}

function assertExpectedGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_ARGUMENT', 'expectedGeneration must be the non-negative generation the caller observed');
  }
}

function assertLockPolicy(value) {
  if (!LOCK_BREAK_POLICIES.includes(value)) {
    fail('INVALID_ARGUMENT', `breakStaleLock must be one of ${LOCK_BREAK_POLICIES.join(', ')}`);
  }
}

function resolveLimits(limits) {
  if (!isPlainObject(limits)) fail('INVALID_LIMIT', 'limits must be a plain object');
  for (const name of Object.keys(limits)) {
    if (!Object.hasOwn(DEFAULT_ACTIVATION_LIMITS, name)) fail('INVALID_LIMIT', `unknown limit ${name}`);
  }
  const resolved = {};
  for (const name of Object.keys(DEFAULT_ACTIVATION_LIMITS)) {
    const value = limits[name] ?? DEFAULT_ACTIVATION_LIMITS[name];
    if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_LIMIT', `${name} must be a positive safe integer`);
    resolved[name] = value;
  }
  return Object.freeze(resolved);
}

// ---------------------------------------------------------------------------------
// Canonical JSON: sorted keys (UTF-16 code units), safe integers only, well-formed
// strings, no insignificant whitespace. A record is accepted only when its bytes equal
// the canonical re-serialisation of its parsed value, which also rejects duplicate
// keys, alternative number spellings, escapes and byte-order marks.

function canonicalValue(value, state, depth) {
  state.nodes += 1;
  if (state.nodes > state.maxNodes) fail('RECORD_INVALID', 'record exceeds the JSON node limit');
  if (depth > state.maxDepth) fail('RECORD_INVALID', 'record exceeds the JSON depth limit');

  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') {
    if (!value.isWellFormed()) fail('RECORD_INVALID', 'record contains a lone surrogate');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail('RECORD_INVALID', 'record numbers must be safe integers');
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalValue(entry, state, depth + 1)).join(',')}]`;
  }
  if (!isPlainObject(value)) fail('RECORD_INVALID', 'record contains a non-JSON value');
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => {
    if (!key.isWellFormed()) fail('RECORD_INVALID', 'record key contains a lone surrogate');
    return `${JSON.stringify(key)}:${canonicalValue(value[key], state, depth + 1)}`;
  }).join(',')}}`;
}

export function canonicalJson(value, limits = DEFAULT_ACTIVATION_LIMITS) {
  return canonicalValue(value, { nodes: 0, maxNodes: limits.jsonNodes, maxDepth: limits.jsonDepth }, 0);
}

export function canonicalBytes(value, limits = DEFAULT_ACTIVATION_LIMITS) {
  return Buffer.from(canonicalJson(value, limits), 'utf8');
}

export function parseCanonicalRecord(bytes, limits = DEFAULT_ACTIVATION_LIMITS, maxBytes = limits.recordBytes) {
  if (!(bytes instanceof Uint8Array)) fail('RECORD_INVALID', 'record bytes must be a Uint8Array');
  if (bytes.length > maxBytes) fail('RECORD_INVALID', 'record exceeds the byte limit');
  if (bytes.length >= 3 && Buffer.from(bytes.subarray(0, 3)).equals(UTF8_BOM)) {
    fail('RECORD_INVALID', 'record must not start with a byte-order mark');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail('RECORD_INVALID', 'record is not valid UTF-8');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('RECORD_INVALID', 'record is not valid JSON');
  }
  if (canonicalJson(value, limits) !== text) fail('RECORD_INVALID', 'record is not in canonical form');
  return value;
}

// ---------------------------------------------------------------------------------
// Input validation. Everything a caller supplies is validated before a byte is written.

function assertStoreId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > STORE_ID_MAX_LENGTH
      || !VISIBLE_ASCII.test(value)) {
    fail('INVALID_ARGUMENT', 'storeId must be 1-256 visible ASCII characters');
  }
}

function assertAppVersion(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > APP_VERSION_MAX_LENGTH
      || !VISIBLE_ASCII.test(value)) {
    fail('INVALID_ARGUMENT', 'appVersion must be 1-128 visible ASCII characters');
  }
}

function isBindingName(value) {
  return typeof value === 'string' && value.length <= BINDING_NAME_MAX_LENGTH && BINDING_NAME.test(value);
}

export function validateResourcePath(value, limits = DEFAULT_ACTIVATION_LIMITS) {
  if (typeof value !== 'string' || value.length === 0) fail('PATH_INVALID', 'resource path must be a non-empty string');
  if (!value.isWellFormed()) fail('PATH_INVALID', 'resource path contains a lone surrogate');
  if (value.normalize('NFC') !== value) fail('PATH_INVALID', 'resource path must be NFC-normalised');
  if (Buffer.byteLength(value, 'utf8') > limits.pathBytes) fail('PATH_INVALID', 'resource path exceeds the byte limit');
  if (PATH_FORBIDDEN.test(value)) fail('PATH_INVALID', 'resource path contains a forbidden character');
  const components = value.split('/');
  if (components.length > limits.pathComponents) fail('PATH_INVALID', 'resource path has too many components');
  for (const component of components) {
    if (component === '' || component === '.' || component === '..') {
      fail('PATH_INVALID', 'resource path has an empty, "." or ".." component');
    }
  }
  return components;
}

// Conservative collision key: compatibility normalisation plus case folding, so keys
// that differ only by case, width or ligature cannot coexist in one version.
function foldPath(value) {
  return value.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');
}

function assertUnambiguousPaths(paths) {
  const folded = new Map();
  const directorySpelling = new Map();
  for (const path of paths) {
    const key = foldPath(path);
    const other = folded.get(key);
    if (other !== undefined) {
      fail(other === path ? 'PATH_DUPLICATE' : 'PATH_COLLISION', 'resource paths are not unambiguous', { path, other });
    }
    folded.set(key, path);
    // Directory names must be unambiguous too: `A/x` and `a/y` would share one
    // directory on a case-insensitive volume and read as the same folder.
    const components = path.split('/');
    for (let length = 1; length < components.length; length += 1) {
      const prefix = components.slice(0, length).join('/');
      const spelling = directorySpelling.get(foldPath(prefix));
      if (spelling !== undefined && spelling !== prefix) {
        fail('PATH_COLLISION', 'directory names differ only by case or compatibility form', { path: prefix, other: spelling });
      }
      directorySpelling.set(foldPath(prefix), prefix);
    }
  }
  // Keep the key space tree-shaped: a key must not also be a directory prefix of
  // another key, so every accepted version can be mapped to and from a plain tree.
  for (const [key, path] of folded) {
    const components = key.split('/');
    for (let length = 1; length < components.length; length += 1) {
      const prefix = components.slice(0, length).join('/');
      if (folded.has(prefix)) {
        fail('PATH_TREE_CONFLICT', 'a resource path is also a directory prefix of another', {
          path,
          other: folded.get(prefix),
        });
      }
    }
  }
}

function assertMediaType(value) {
  if (typeof value !== 'string' || !MEDIA_TYPE.test(value)) fail('MEDIA_TYPE_INVALID', `invalid media type ${JSON.stringify(value)}`);
}

function sourceOf(item, label) {
  const hasBytes = Object.hasOwn(item, 'bytes');
  const hasChunks = Object.hasOwn(item, 'chunks');
  if (hasBytes === hasChunks) fail('INVALID_ARGUMENT', `${label} needs exactly one of bytes or chunks`);
  if (hasBytes) {
    if (!(item.bytes instanceof Uint8Array)) fail('INVALID_ARGUMENT', `${label}.bytes must be a Uint8Array`);
    return { bytes: item.bytes };
  }
  const { chunks } = item;
  if (chunks == null
      || (typeof chunks[Symbol.asyncIterator] !== 'function' && typeof chunks[Symbol.iterator] !== 'function')) {
    fail('INVALID_ARGUMENT', `${label}.chunks must be iterable`);
  }
  return { chunks };
}

async function* chunksOf(source) {
  if (source.bytes) {
    yield source.bytes;
    return;
  }
  for await (const chunk of source.chunks) {
    if (!(chunk instanceof Uint8Array)) fail('INVALID_ARGUMENT', 'stream chunks must be Uint8Array values');
    yield chunk;
  }
}

function planBindings(bindings, limits, { allowReference }) {
  if (bindings === undefined) return [];
  if (!isPlainObject(bindings)) fail('BINDING_INVALID', 'bindings must be a plain object');
  const names = Object.keys(bindings).sort();
  if (names.length > limits.bindings) fail('LIMIT_EXCEEDED', 'too many bindings', { max: limits.bindings });
  return names.map((name) => {
    if (!isBindingName(name)) fail('BINDING_INVALID', `invalid binding name ${JSON.stringify(name)}`);
    const item = bindings[name];
    const label = `binding ${name}`;
    const isReference = isPlainObject(item) && !Object.hasOwn(item, 'bytes') && !Object.hasOwn(item, 'chunks');
    if (isReference && !allowReference) fail('BINDING_INVALID', `${label} must carry its bytes`);
    assertExactKeys(item, ['digest', 'size'], isReference ? [] : ['bytes', 'chunks'], label);
    assertDigest(item.digest, `${label}.digest`, 'BINDING_INVALID');
    assertSize(item.size, limits.bindingBytes, `${label}.size`);
    return { name, digest: item.digest, size: item.size, source: isReference ? null : sourceOf(item, label) };
  });
}

function planVersion(input, storeId, limits) {
  assertExactKeys(input, ['appVersion', 'packageDigest', 'resources'], ['bindings'], 'version input');
  assertAppVersion(input.appVersion);
  assertDigest(input.packageDigest, 'packageDigest');
  if (!Array.isArray(input.resources) || input.resources.length === 0) {
    fail('INVALID_ARGUMENT', 'resources must be a non-empty array');
  }
  if (input.resources.length > limits.resources) fail('LIMIT_EXCEEDED', 'too many resources', { max: limits.resources });

  let totalBytes = 0;
  const resources = input.resources.map((item, index) => {
    const label = `resources[${index}]`;
    assertExactKeys(item, ['path', 'mediaType', 'digest', 'size'], ['bytes', 'chunks'], label);
    validateResourcePath(item.path, limits);
    assertMediaType(item.mediaType);
    assertDigest(item.digest, `${label}.digest`);
    assertSize(item.size, limits.resourceBytes, `${label}.size`);
    totalBytes += item.size;
    return {
      path: item.path,
      mediaType: item.mediaType,
      digest: item.digest,
      size: item.size,
      source: sourceOf(item, label),
    };
  });
  if (totalBytes > limits.totalBytes) fail('LIMIT_EXCEEDED', 'aggregate resource size exceeds the limit', { totalBytes });
  resources.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  assertUnambiguousPaths(resources.map((resource) => resource.path));

  const bindings = planBindings(input.bindings, limits, { allowReference: false });
  const record = {
    schema: ACTIVATION_SCHEMA.version,
    storeId,
    appVersion: input.appVersion,
    packageDigest: input.packageDigest,
    resources: resources.map(({ path, mediaType, digest, size }) => ({ path, mediaType, digest, size })),
    bindings: Object.fromEntries(bindings.map(({ name, digest, size }) => [name, { digest, size }])),
  };
  return { resources, bindings, record };
}

// ---------------------------------------------------------------------------------
// Record validation. Records read back from disk are untrusted until validated.

function validateBindingMap(value, limits, label, code) {
  if (!isPlainObject(value)) fail(code, `${label} bindings must be an object`);
  const names = Object.keys(value);
  if (names.length > limits.bindings) fail(code, `${label} has too many bindings`);
  for (const name of names) {
    if (!isBindingName(name)) fail(code, `${label} has an invalid binding name`);
    const entry = value[name];
    if (!isPlainObject(entry) || Object.keys(entry).sort().join(',') !== 'digest,size'
        || typeof entry.digest !== 'string' || !HEX_64.test(entry.digest)
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > limits.bindingBytes) {
      fail(code, `${label} binding ${name} is malformed`);
    }
  }
}

function validateVersionRecord(record, storeId, limits) {
  const code = 'VERSION_INVALID';
  if (!isPlainObject(record)) fail(code, 'version record must be an object');
  if (Object.keys(record).sort().join(',') !== 'appVersion,bindings,packageDigest,resources,schema,storeId') {
    fail(code, 'version record has unexpected fields');
  }
  if (record.schema !== ACTIVATION_SCHEMA.version) fail(code, 'unsupported version record schema');
  if (record.storeId !== storeId) fail('NAMESPACE_MISMATCH', 'version record belongs to another store', { storeId: record.storeId });
  try {
    assertAppVersion(record.appVersion);
    assertDigest(record.packageDigest, 'packageDigest');
  } catch (error) {
    fail(code, `version record header is malformed: ${error.message}`);
  }
  if (!Array.isArray(record.resources) || record.resources.length === 0 || record.resources.length > limits.resources) {
    fail(code, 'version record resource list is malformed');
  }
  let totalBytes = 0;
  let previousPath = null;
  for (const entry of record.resources) {
    if (!isPlainObject(entry) || Object.keys(entry).sort().join(',') !== 'digest,mediaType,path,size') {
      fail(code, 'version record resource entry is malformed');
    }
    try {
      validateResourcePath(entry.path, limits);
      assertMediaType(entry.mediaType);
      assertDigest(entry.digest, 'digest');
      assertSize(entry.size, limits.resourceBytes, 'size');
    } catch (error) {
      fail(code, `version record resource entry is invalid: ${error.message}`);
    }
    if (previousPath !== null && !(previousPath < entry.path)) fail(code, 'version record resources are not strictly sorted');
    previousPath = entry.path;
    totalBytes += entry.size;
  }
  if (totalBytes > limits.totalBytes) fail(code, 'version record exceeds the aggregate size limit');
  try {
    assertUnambiguousPaths(record.resources.map((entry) => entry.path));
  } catch (error) {
    fail(code, `version record paths are ambiguous: ${error.message}`);
  }
  validateBindingMap(record.bindings, limits, 'version record', code);
  return record;
}

function commitBody(commit) {
  const { checksum, ...body } = commit;
  return body;
}

function validateCommitRecord(record, storeId, limits) {
  const code = 'COMMIT_INVALID';
  if (!isPlainObject(record)) fail(code, 'commit record must be an object');
  if (Object.keys(record).sort().join(',') !== 'active,bindings,checksum,generation,previous,reason,schema,storeId') {
    fail(code, 'commit record has unexpected fields');
  }
  if (record.schema !== ACTIVATION_SCHEMA.commit) fail(code, 'unsupported commit record schema');
  if (record.storeId !== storeId) fail('NAMESPACE_MISMATCH', 'commit record belongs to another store', { storeId: record.storeId });
  if (!Number.isSafeInteger(record.generation) || record.generation < 1) fail(code, 'commit generation is malformed');
  for (const field of ['active', 'previous']) {
    if (record[field] !== null && (typeof record[field] !== 'string' || !HEX_64.test(record[field]))) {
      fail(code, `commit ${field} is malformed`);
    }
  }
  if (record.active === null && record.previous !== null) fail(code, 'commit has a previous version without an active one');
  if (record.active !== null && record.active === record.previous) fail(code, 'commit previous equals active');
  if (!COMMIT_REASONS.includes(record.reason)) fail(code, 'commit reason is unknown');
  validateBindingMap(record.bindings, limits, 'commit record', code);
  if (typeof record.checksum !== 'string' || !HEX_64.test(record.checksum)) fail(code, 'commit checksum is malformed');
  if (sha256Hex(canonicalBytes(commitBody(record), limits)) !== record.checksum) fail(code, 'commit checksum mismatch');
  return record;
}

function statusOf(commit) {
  if (commit === null) return { generation: 0, active: null, previous: null, bindings: {}, reason: null };
  return {
    generation: commit.generation,
    active: commit.active,
    previous: commit.previous,
    bindings: commit.bindings,
    reason: commit.reason,
  };
}

function findResource(resources, path) {
  let low = 0;
  let high = resources.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = resources[middle].path;
    if (candidate === path) return resources[middle];
    if (candidate < path) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

function defaultProcessProbe() {
  return {
    pid: process.pid,
    hostname: osHostname(),
    isAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error?.code === 'EPERM';
      }
    },
  };
}

// ---------------------------------------------------------------------------------

function defaultRandomHex() {
  return randomBytes(16).toString('hex');
}

// `processProbe` and `randomHex` exist for deterministic harnesses. `randomHex` must
// return a fresh 32-character lowercase hex string on every call (temporary and lock
// names); production callers keep the cryptographic default.
export async function openActivationStore({
  root,
  storeId,
  io = createNodeIo(),
  create = false,
  limits = DEFAULT_ACTIVATION_LIMITS,
  processProbe = defaultProcessProbe(),
  randomHex = defaultRandomHex,
} = {}) {
  assertStoreId(storeId);
  if (typeof root !== 'string' || root.length === 0) fail('INVALID_ARGUMENT', 'root must be a non-empty path string');
  if (typeof randomHex !== 'function') fail('INVALID_ARGUMENT', 'randomHex must be a function');
  const store = new ActivationStore({
    root: io.resolve(root),
    storeId,
    io,
    limits: resolveLimits(limits),
    processProbe,
    randomHex,
  });
  await store._open(create === true);
  return store;
}

export class ActivationStore {
  constructor({ root, storeId, io, limits, processProbe, randomHex = defaultRandomHex }) {
    this.root = root;
    this.storeId = storeId;
    this.io = io;
    this.limits = limits;
    this.processProbe = processProbe;
    this.randomHexSource = randomHex;
    // Set when this instance found its own lock replaced by another actor on release.
    this.lockLost = false;
  }

  path(...parts) {
    return this.io.join(this.root, ...parts);
  }

  objectPath(digest) {
    return this.path('objects', digest.slice(0, 2), digest.slice(2));
  }

  _randomHex() {
    const value = this.randomHexSource();
    if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) {
      fail('INVALID_ARGUMENT', 'randomHex returned an invalid value');
    }
    return value;
  }

  async _readFileBounded(path, maxBytes, invalidCode) {
    try {
      return await this.io.readFile(path, maxBytes);
    } catch (error) {
      if (UNREADABLE_ENTRY.has(ioErrorCode(error))) {
        fail(invalidCode, 'entry is not a readable regular file of acceptable size', { code: ioErrorCode(error) });
      }
      throw error;
    }
  }

  // ------------------------------------------------------------------ open / layout

  async _ensureDirectory(path) {
    if (await this.io.mkdir(path, DIRECTORY_MODE)) return true;
    const stat = await this.io.lstat(path);
    if (stat?.type !== 'dir') fail('STORE_LAYOUT_INVALID', 'store directory is not a real directory', { path });
    return false;
  }

  async _syncParentOfRoot() {
    try {
      await this.io.syncDir(this.io.dirname(this.root));
    } catch (error) {
      // The parent is not ours. Failing to sync it weakens durability of the root
      // entry only; it never makes a partially initialised store look complete.
      if (!['EACCES', 'EPERM'].includes(ioErrorCode(error))) throw error;
    }
  }

  async _open(create) {
    const rootStat = await this.io.lstat(this.root);
    if (rootStat === null) {
      if (!create) fail('STORE_NOT_INITIALIZED', 'store root does not exist', { root: this.root });
      try {
        await this.io.mkdir(this.root, DIRECTORY_MODE);
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(ioErrorCode(error))) {
          fail('STORE_ROOT_INVALID', 'the parent of the store root does not exist', { root: this.root });
        }
        throw error;
      }
    } else if (rootStat.type !== 'dir') {
      fail('STORE_ROOT_INVALID', 'store root must be a real directory, not a link or file', { type: rootStat.type });
    } else if (this.io.platform !== 'win32' && typeof rootStat.mode === 'number' && (rootStat.mode & 0o002) !== 0) {
      fail('STORE_ROOT_INVALID', 'store root must not be world-writable');
    }

    const markerPath = this.path('STORE');
    const marker = await this._readFileBounded(markerPath, MARKER_MAX_BYTES, 'STORE_LAYOUT_INVALID');
    if (marker === null) {
      if (!create) fail('STORE_NOT_INITIALIZED', 'store marker is missing', { root: this.root });
      // Directories first, marker last: a visible marker implies a complete layout.
      // An interrupted initialisation never writes into these directories, so finding
      // one that is not empty means the root holds foreign content. Adopting it would
      // let recovery delete files it does not own (for example everything in tmp/).
      for (const name of STORE_DIRECTORIES) {
        const path = this.path(name);
        if (!(await this._ensureDirectory(path)) && (await this.io.readdir(path)).length > 0) {
          fail('STORE_ROOT_INVALID', `refusing to initialise over existing content in ${name}/`, { root: this.root });
        }
      }
      const bytes = canonicalBytes({ schema: ACTIVATION_SCHEMA.store, storeId: this.storeId }, this.limits);
      const temp = this.path(`.tmp-store-${this._randomHex()}`);
      await this._writeTempDurably(temp, bytes, PRIVATE_FILE_MODE, MARKER_MAX_BYTES);
      await this.io.rename(temp, markerPath);
      // Completing an initialisation must make the root entry durable as well: the
      // root may have been created by an earlier attempt that crashed before syncing
      // its parent (found by the crash matrix, post-recovery power-loss model).
      await this._syncParentOfRoot();
      await this.io.syncDir(this.root);
      return;
    }

    let value;
    try {
      value = parseCanonicalRecord(marker, this.limits, MARKER_MAX_BYTES);
    } catch {
      fail('STORE_LAYOUT_INVALID', 'store marker is malformed');
    }
    if (!isPlainObject(value) || value.schema !== ACTIVATION_SCHEMA.store
        || Object.keys(value).sort().join(',') !== 'schema,storeId') {
      fail('STORE_LAYOUT_INVALID', 'store marker is malformed');
    }
    if (value.storeId !== this.storeId) fail('STORE_ID_MISMATCH', 'store belongs to another storeId', { storeId: value.storeId });
    // A marker is only ever published after the directories exist, so a missing or
    // replaced directory is damage. Recreating it would silently heal lost state.
    for (const name of STORE_DIRECTORIES) {
      const stat = await this.io.lstat(this.path(name));
      if (stat?.type !== 'dir') fail('STORE_LAYOUT_INVALID', `store directory ${name} is missing or not a real directory`);
    }
  }

  // ------------------------------------------------------------------------- locking

  async _readLockHolder(lockPath) {
    let bytes;
    try {
      bytes = await this.io.readFile(lockPath, LOCK_MAX_BYTES);
    } catch (error) {
      if (UNREADABLE_ENTRY.has(ioErrorCode(error))) return { holder: null };
      throw error;
    }
    if (bytes === null) return null;
    let value = null;
    try {
      value = parseCanonicalRecord(bytes, this.limits, LOCK_MAX_BYTES);
    } catch {
      value = null;
    }
    const valid = isPlainObject(value) && value.schema === ACTIVATION_SCHEMA.lock
      && Number.isSafeInteger(value.pid) && typeof value.hostname === 'string' && typeof value.token === 'string';
    return { holder: valid ? value : null };
  }

  // Only a lock whose owner is provably dead on this host may be broken automatically.
  // An unreadable lock, a foreign host or a live (possibly reused) pid is never stale.
  _lockIsProvablyStale(holder) {
    if (holder === null) return false;
    if (holder.hostname !== this.processProbe.hostname) return false;
    if (holder.pid === this.processProbe.pid) return false;
    return !this.processProbe.isAlive(holder.pid);
  }

  async _acquireLock(breakPolicy) {
    const token = this._randomHex();
    const content = canonicalBytes({
      schema: ACTIVATION_SCHEMA.lock,
      pid: this.processProbe.pid,
      hostname: this.processProbe.hostname,
      token,
    }, this.limits);
    const temp = this.path('tmp', `lock-${token}`);
    const lockPath = this.path('state', 'LOCK');
    // The lock appears atomically with complete, durable content: it is created by
    // hard-linking a fully written and synced file, and link() never replaces.
    await this._writeTempDurably(temp, content, PRIVATE_FILE_MODE, LOCK_MAX_BYTES);
    let brokeStale = false;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (await this.io.link(temp, lockPath)) return { content, lockPath, brokeStale };
        const current = await this._readLockHolder(lockPath);
        if (current === null) continue;
        const breakable = breakPolicy === 'force'
          || (breakPolicy === 'if-provably-stale' && this._lockIsProvablyStale(current.holder));
        if (!breakable) {
          fail('STORE_LOCKED', 'store is locked by another writer', {
            holder: current.holder ? { pid: current.holder.pid, hostname: current.holder.hostname } : 'unreadable',
          });
        }
        await this._unlinkIfExists(lockPath);
        brokeStale = true;
      }
      fail('STORE_LOCKED', 'store lock is contended');
    } finally {
      await this._unlinkIfExists(temp);
    }
  }

  async _releaseLock(lock) {
    let current = null;
    try {
      current = await this.io.readFile(lock.lockPath, LOCK_MAX_BYTES);
    } catch (error) {
      if (!UNREADABLE_ENTRY.has(ioErrorCode(error))) throw error;
    }
    if (current !== null && current.equals(lock.content)) {
      await this.io.unlink(lock.lockPath);
    } else {
      // Another actor force-broke this lock while it was held. Never delete a lock we
      // do not own; surface the anomaly instead.
      this.lockLost = true;
    }
  }

  async _withLock(operation, breakPolicy = 'never') {
    const lock = await this._acquireLock(breakPolicy);
    try {
      return await operation(lock);
    } finally {
      await this._releaseLock(lock);
    }
  }

  // ---------------------------------------------------------------- low-level writes

  async _unlinkIfExists(path) {
    try {
      await this.io.unlink(path);
      return true;
    } catch (error) {
      if (ioErrorCode(error) === 'ENOENT') return false;
      throw error;
    }
  }

  // Exclusive create (never follows or replaces an existing entry), full write, fsync.
  async _writeDurably(path, source, { mode, maxBytes, expectedSize }) {
    const handle = await this.io.createExclusive(path, mode);
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of chunksOf(source)) {
        size += chunk.byteLength;
        if (size > maxBytes) fail('LIMIT_EXCEEDED', 'object exceeds the configured byte limit', { maxBytes });
        if (expectedSize !== undefined && size > expectedSize) {
          fail('OBJECT_SIZE_MISMATCH', 'object is larger than its declared size', { expectedSize });
        }
        hash.update(chunk);
        await handle.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { digest: hash.digest('hex'), size };
  }

  async _writeTempDurably(path, bytes, mode, maxBytes) {
    try {
      return await this._writeDurably(path, { bytes }, { mode, maxBytes });
    } catch (error) {
      await this._unlinkIfExists(path);
      throw error;
    }
  }

  async _existingObjectState(digest, size) {
    const path = this.objectPath(digest);
    const stat = await this.io.lstat(path);
    if (stat === null) return 'absent';
    if (stat.type !== 'file') return 'occupied';
    if (stat.size !== size) return 'corrupt';
    let bytes;
    try {
      bytes = await this.io.readFile(path, Math.max(size, 1));
    } catch (error) {
      if (UNREADABLE_ENTRY.has(ioErrorCode(error))) return 'corrupt';
      throw error;
    }
    if (bytes === null) return 'absent';
    return sha256Hex(bytes) === digest ? 'valid' : 'corrupt';
  }

  // Writes one object after verifying the streamed bytes against the declared digest
  // and size. An existing valid object is reused; a corrupt regular file at the same
  // address is replaced; any other occupant fails closed and is left as evidence.
  async _putObject(source, { expectedDigest, expectedSize, maxBytes }, stats) {
    const temp = this.path('tmp', `obj-${this._randomHex()}`);
    let written;
    try {
      written = await this._writeDurably(temp, source, { mode: OBJECT_MODE, maxBytes, expectedSize });
      if (expectedSize !== undefined && written.size !== expectedSize) {
        fail('OBJECT_SIZE_MISMATCH', 'object size differs from its declared size', { expectedSize, actual: written.size });
      }
      if (expectedDigest !== undefined && written.digest !== expectedDigest) {
        fail('OBJECT_DIGEST_MISMATCH', 'object digest differs from its declared digest', { expectedDigest });
      }
    } catch (error) {
      await this._unlinkIfExists(temp);
      throw error;
    }

    const { digest, size } = written;
    const fanout = this.path('objects', digest.slice(0, 2));
    if (await this._ensureDirectory(fanout)) stats.dirtyDirectories.add(this.path('objects'));
    // Reused objects still get their directory synced: that keeps the commit protocol
    // correct even if a caller skipped recovery after an interrupted staging.
    stats.dirtyDirectories.add(fanout);
    const existing = await this._existingObjectState(digest, size);
    if (existing === 'occupied') {
      await this._unlinkIfExists(temp);
      fail('STORE_LAYOUT_INVALID', 'object path is occupied by a non-regular file', { digest });
    }
    if (existing === 'valid') {
      await this.io.unlink(temp);
      stats.reused += 1;
      return { digest, size, reused: true };
    }
    if (existing === 'corrupt') {
      await this.io.unlink(this.objectPath(digest));
      stats.repaired += 1;
    }
    await this.io.rename(temp, this.objectPath(digest));
    stats.written += 1;
    stats.bytes += size;
    return { digest, size, reused: false };
  }

  async _syncDirectories(directories) {
    for (const directory of [...directories].sort()) await this.io.syncDir(directory);
  }

  // ------------------------------------------------------------------- read helpers

  async _readObject(digest, maxBytes) {
    assertDigest(digest, 'digest');
    const path = this.objectPath(digest);
    const stat = await this.io.lstat(path);
    if (stat === null) fail('OBJECT_MISSING', 'object is missing', { digest });
    if (stat.type !== 'file') fail('OBJECT_CORRUPT', 'object is not a regular file', { digest });
    if (stat.size > maxBytes) fail('OBJECT_CORRUPT', 'object exceeds its expected size', { digest });
    const bytes = await this._readFileBounded(path, maxBytes, 'OBJECT_CORRUPT');
    if (bytes === null) fail('OBJECT_MISSING', 'object is missing', { digest });
    if (sha256Hex(bytes) !== digest) fail('OBJECT_CORRUPT', 'object bytes do not match their address', { digest });
    return bytes;
  }

  async readVersion(versionId) {
    assertDigest(versionId, 'versionId');
    let bytes;
    try {
      bytes = await this._readObject(versionId, this.limits.recordBytes);
    } catch (error) {
      if (!(error instanceof ActivationError)) throw error;
      if (error.code === 'OBJECT_MISSING') fail('VERSION_MISSING', 'version record is missing', { versionId });
      fail('VERSION_INVALID', `version record is unreadable: ${error.message}`, { versionId });
    }
    let value;
    try {
      value = parseCanonicalRecord(bytes, this.limits);
    } catch (error) {
      fail('VERSION_INVALID', `version record is malformed: ${error.message}`, { versionId });
    }
    return validateVersionRecord(value, this.storeId, this.limits);
  }

  async readCommit() {
    const bytes = await this._readFileBounded(this.path('state', 'CURRENT'), this.limits.recordBytes, 'COMMIT_INVALID');
    if (bytes === null) return null;
    let value;
    try {
      value = parseCanonicalRecord(bytes, this.limits);
    } catch (error) {
      fail('COMMIT_INVALID', `commit record is malformed: ${error.message}`);
    }
    return validateCommitRecord(value, this.storeId, this.limits);
  }

  async status() {
    return statusOf(await this.readCommit());
  }

  // Full verification re-hashes every object a version needs. It never repairs.
  async verifyVersion(versionId) {
    let record;
    try {
      record = await this.readVersion(versionId);
    } catch (error) {
      if (!(error instanceof ActivationError)) throw error;
      return { ok: false, versionId, problems: [{ code: error.code, ref: 'record' }] };
    }
    const problems = [];
    const entries = [
      ...record.resources.map((entry) => ({ digest: entry.digest, size: entry.size, ref: entry.path })),
      ...Object.entries(record.bindings).map(([name, entry]) => ({ ...entry, ref: `binding:${name}` })),
    ];
    for (const entry of entries) {
      try {
        const bytes = await this._readObject(entry.digest, Math.max(entry.size, 1));
        if (bytes.length !== entry.size) problems.push({ code: 'OBJECT_CORRUPT', ref: entry.ref });
      } catch (error) {
        if (!(error instanceof ActivationError)) throw error;
        problems.push({ code: error.code, ref: entry.ref });
      }
    }
    return { ok: problems.length === 0, versionId, problems };
  }

  async _verifyBindingObjects(bindings) {
    for (const [name, entry] of Object.entries(bindings)) {
      try {
        const bytes = await this._readObject(entry.digest, Math.max(entry.size, 1));
        if (bytes.length !== entry.size) fail('OBJECT_CORRUPT', 'binding size mismatch');
      } catch (error) {
        if (!(error instanceof ActivationError)) throw error;
        fail('BINDING_INVALID', `binding ${name} does not reference a valid object (${error.code})`, { name });
      }
    }
  }

  // Serving primitive for a runtime: resolves a key in the active (or given) version
  // and re-verifies the object bytes on every read.
  async readResource(path, { versionId } = {}) {
    validateResourcePath(path, this.limits);
    let target = versionId;
    if (target === undefined) {
      const commit = await this.readCommit();
      if (commit === null || commit.active === null) fail('NO_ACTIVE_VERSION', 'no version is active');
      target = commit.active;
    }
    const record = await this.readVersion(target);
    const entry = findResource(record.resources, path);
    if (entry === null) fail('RESOURCE_NOT_FOUND', 'resource is not part of the version', { path });
    let bytes;
    try {
      bytes = await this._readObject(entry.digest, Math.max(entry.size, 1));
    } catch (error) {
      if (error instanceof ActivationError) fail('RESOURCE_INTEGRITY', `resource failed its integrity check (${error.code})`, { path });
      throw error;
    }
    if (bytes.length !== entry.size) fail('RESOURCE_INTEGRITY', 'resource size mismatch', { path });
    return { versionId: target, path, mediaType: entry.mediaType, size: entry.size, digest: entry.digest, bytes };
  }

  // --------------------------------------------------------------------- staging

  // Writes every declared object after verifying its bytes against the declared digest
  // and size, then the content-addressed version record. Nothing becomes active, and a
  // staged version is not a GC root until a commit references it.
  async stageVersion(input) {
    const plan = planVersion(input, this.storeId, this.limits);
    const recordBytes = canonicalBytes(plan.record, this.limits);
    if (recordBytes.length > this.limits.recordBytes) fail('LIMIT_EXCEEDED', 'version record exceeds the byte limit');

    return this._withLock(async () => {
      const stats = { written: 0, reused: 0, repaired: 0, bytes: 0, dirtyDirectories: new Set() };
      for (const item of [...plan.resources, ...plan.bindings]) {
        await this._putObject(item.source, {
          expectedDigest: item.digest,
          expectedSize: item.size,
          maxBytes: item.path === undefined ? this.limits.bindingBytes : this.limits.resourceBytes,
        }, stats);
      }
      const { digest: versionId } = await this._putObject({ bytes: recordBytes }, {
        maxBytes: this.limits.recordBytes,
      }, stats);
      await this._syncDirectories(stats.dirtyDirectories);
      return {
        versionId,
        objectsWritten: stats.written,
        objectsReused: stats.reused,
        objectsRepaired: stats.repaired,
        bytesWritten: stats.bytes,
      };
    });
  }

  // ---------------------------------------------------------------------- commits

  async _stageBindings(spec, stats) {
    const bindings = {};
    for (const item of planBindings(spec, this.limits, { allowReference: true })) {
      if (item.source !== null) {
        await this._putObject(item.source, {
          expectedDigest: item.digest,
          expectedSize: item.size,
          maxBytes: this.limits.bindingBytes,
        }, stats);
      }
      bindings[item.name] = { digest: item.digest, size: item.size };
    }
    return bindings;
  }

  // The single commit point. Every object reachable from `next` must already be durable.
  async _writeCommit(next) {
    const body = { schema: ACTIVATION_SCHEMA.commit, storeId: this.storeId, ...next };
    const checksum = sha256Hex(canonicalBytes(body, this.limits));
    const bytes = canonicalBytes({ ...body, checksum }, this.limits);
    const temp = this.path('state', `.tmp-commit-${this._randomHex()}`);
    await this._writeTempDurably(temp, bytes, PRIVATE_FILE_MODE, this.limits.recordBytes);
    try {
      await this.io.rename(temp, this.path('state', 'CURRENT'));
    } catch (error) {
      await this._unlinkIfExists(temp);
      throw error;
    }
    return (await this.io.syncDir(this.path('state'))) ? 'directory-fsync' : 'unavailable';
  }

  async _collectGarbageAfterCommit(commit) {
    // A committed state is never reported as a failure because housekeeping failed.
    try {
      return await this._collectGarbage(commit);
    } catch (error) {
      return { error: { code: ioErrorCode(error) ?? 'GC_FAILED', message: error.message } };
    }
  }

  async _commitTransition(expectedGeneration, decide, isNoop = () => false) {
    assertExpectedGeneration(expectedGeneration);
    return this._withLock(async () => {
      const current = await this.readCommit();
      if (isNoop(current)) return { changed: false, ...statusOf(current) };
      const generation = current?.generation ?? 0;
      if (generation !== expectedGeneration) {
        fail('GENERATION_CONFLICT', 'store generation changed since it was observed', { expectedGeneration, generation });
      }
      const stats = { written: 0, reused: 0, repaired: 0, bytes: 0, dirtyDirectories: new Set() };
      const next = await decide(current, stats);
      await this._verifyBindingObjects(next.bindings);
      await this._syncDirectories(stats.dirtyDirectories);
      const commit = { ...next, generation: generation + 1 };
      const commitBarrier = await this._writeCommit(commit);
      const gc = await this._collectGarbageAfterCommit(commit);
      return { changed: true, ...statusOf(commit), commitBarrier, gc };
    });
  }

  async _lastGoodCandidate(current, excluding) {
    for (const candidate of [current?.active, current?.previous]) {
      if (!candidate || candidate === excluding) continue;
      if ((await this.verifyVersion(candidate)).ok) return candidate;
    }
    return null;
  }

  // Atomically makes `versionId` active after re-verifying all of its objects. The
  // displaced version becomes last-good only if it still verifies; otherwise an older
  // last-good that still verifies is kept. Re-activating the active version without
  // new bindings is an idempotent no-op, which keeps retries after a crash safe.
  async activate(versionId, { expectedGeneration, bindings } = {}) {
    assertDigest(versionId, 'versionId');
    return this._commitTransition(
      expectedGeneration,
      async (current, stats) => {
        const check = await this.verifyVersion(versionId);
        if (!check.ok) fail('VERSION_INVALID', 'version failed verification and cannot be activated', { versionId, problems: check.problems });
        const nextBindings = bindings === undefined ? current?.bindings ?? {} : await this._stageBindings(bindings, stats);
        const previous = current?.active === versionId
          ? current.previous
          : await this._lastGoodCandidate(current, versionId);
        return { active: versionId, previous, bindings: nextBindings, reason: 'activate' };
      },
      (current) => current?.active === versionId && bindings === undefined,
    );
  }

  // Deterministic rollback to the recorded last-good version. The version rolled back
  // from becomes the new last-good only if it still verifies. Commit-level bindings are
  // carried forward unchanged: update metadata must never roll back with the package.
  async rollback({ expectedGeneration } = {}) {
    return this._commitTransition(expectedGeneration, async (current) => {
      if (!current?.previous) fail('NO_LAST_GOOD', 'no last-good version is recorded');
      const target = await this.verifyVersion(current.previous);
      if (!target.ok) fail('LAST_GOOD_INVALID', 'recorded last-good version failed verification', { problems: target.problems });
      const displaced = (await this.verifyVersion(current.active)).ok ? current.active : null;
      return { active: current.previous, previous: displaced, bindings: current.bindings, reason: 'rollback' };
    });
  }

  // Replaces the commit-level bindings (for example trusted update metadata) in the
  // same atomic commit that names the active version, without changing active or
  // last-good. Entries may carry bytes or reference an existing object by digest.
  async commitBindings(bindings, { expectedGeneration } = {}) {
    if (!isPlainObject(bindings)) fail('BINDING_INVALID', 'bindings must be a plain object');
    return this._commitTransition(expectedGeneration, async (current, stats) => ({
      active: current?.active ?? null,
      previous: current?.previous ?? null,
      bindings: await this._stageBindings(bindings, stats),
      reason: 'bind',
    }));
  }

  // ------------------------------------------------------------ recovery and GC

  async _removeTemporaryFiles({ includeRoot = false } = {}) {
    let removed = 0;
    // Under the store lock every file in tmp/ belongs to an interrupted writer.
    for (const name of await this.io.readdir(this.path('tmp'))) {
      if (await this._unlinkIfExists(this.path('tmp', name))) removed += 1;
    }
    const scopes = [[this.path('state'), '.tmp-']];
    if (includeRoot) scopes.push([this.root, '.tmp-store-']);
    for (const [directory, prefix] of scopes) {
      for (const name of await this.io.readdir(directory)) {
        if (name.startsWith(prefix) && await this._unlinkIfExists(this.io.join(directory, name))) removed += 1;
      }
    }
    return removed;
  }

  // Deletes only objects unreachable from the given commit. If a root cannot be read,
  // nothing is deleted: a collector that cannot enumerate its roots must not guess.
  async _collectGarbage(commit) {
    const report = { removedObjects: 0, keptObjects: 0, removedTemporary: 0, anomalies: [], skipped: null };
    report.removedTemporary = await this._removeTemporaryFiles();

    const reachable = new Set();
    if (commit !== null) {
      for (const entry of Object.values(commit.bindings)) reachable.add(entry.digest);
      for (const versionId of [commit.active, commit.previous]) {
        if (versionId === null) continue;
        let record;
        try {
          record = await this.readVersion(versionId);
        } catch (error) {
          if (!(error instanceof ActivationError)) throw error;
          report.skipped = { reason: 'root-unreadable', versionId, code: error.code };
          return report;
        }
        reachable.add(versionId);
        for (const entry of record.resources) reachable.add(entry.digest);
        for (const entry of Object.values(record.bindings)) reachable.add(entry.digest);
      }
    }

    const objectsDirectory = this.path('objects');
    for (const fanout of await this.io.readdir(objectsDirectory)) {
      const fanoutPath = this.io.join(objectsDirectory, fanout);
      const stat = await this.io.lstat(fanoutPath);
      if (!OBJECT_FANOUT.test(fanout) || stat?.type !== 'dir') {
        report.anomalies.push({ path: `objects/${fanout}`, reason: 'unexpected-entry' });
        continue;
      }
      for (const name of await this.io.readdir(fanoutPath)) {
        if (!OBJECT_NAME.test(name)) {
          report.anomalies.push({ path: `objects/${fanout}/${name}`, reason: 'unexpected-entry' });
          continue;
        }
        if (reachable.has(fanout + name)) {
          report.keptObjects += 1;
          continue;
        }
        if (await this._unlinkIfExists(this.io.join(fanoutPath, name))) report.removedObjects += 1;
      }
    }
    return report;
  }

  async collectGarbage({ breakStaleLock = 'never' } = {}) {
    assertLockPolicy(breakStaleLock);
    return this._withLock(async () => {
      const commit = await this.readCommit();
      // Make the visible commit durable before deleting anything it displaced.
      await this.io.syncDir(this.path('state'));
      return this._collectGarbage(commit);
    }, breakStaleLock);
  }

  // Startup recovery. Removes interrupted temporaries, re-establishes the durability
  // barrier for the visible commit, verifies active, last-good and bindings, and
  // collects garbage only when every root verifies. It never switches versions on its
  // own: an invalid active version is reported fail-closed together with whether a
  // verified rollback target exists.
  async recover({ breakStaleLock = 'if-provably-stale' } = {}) {
    assertLockPolicy(breakStaleLock);
    return this._withLock(async (lock) => {
      const report = {
        brokeStaleLock: lock.brokeStale,
        removedTemporary: await this._removeTemporaryFiles({ includeRoot: true }),
        commitBarrier: null,
        ...statusOf(null),
        activeValid: null,
        previousValid: null,
        bindingsValid: null,
        rollbackAvailable: false,
        gc: null,
      };
      const commit = await this.readCommit();
      // Re-establish every barrier of the visible state before deleting anything: an
      // interrupted initialisation or commit may have published entries (root, marker,
      // CURRENT) whose directory sync never ran. Objects referenced by a visible commit
      // were synced before that commit's rename, so they need no second barrier.
      await this._syncParentOfRoot();
      await this.io.syncDir(this.root);
      report.commitBarrier = (await this.io.syncDir(this.path('state'))) ? 'directory-fsync' : 'unavailable';
      if (commit === null) {
        report.gc = await this._collectGarbageAfterCommit(null);
        return report;
      }
      Object.assign(report, statusOf(commit));
      const activeCheck = commit.active === null ? null : await this.verifyVersion(commit.active);
      const previousCheck = commit.previous === null ? null : await this.verifyVersion(commit.previous);
      report.activeValid = activeCheck === null ? null : activeCheck.ok;
      report.previousValid = previousCheck === null ? null : previousCheck.ok;
      report.rollbackAvailable = previousCheck?.ok === true;
      if (activeCheck?.ok === false) report.activeProblems = activeCheck.problems;
      if (previousCheck?.ok === false) report.previousProblems = previousCheck.problems;
      try {
        await this._verifyBindingObjects(commit.bindings);
        report.bindingsValid = true;
      } catch (error) {
        if (!(error instanceof ActivationError)) throw error;
        report.bindingsValid = false;
        report.bindingProblem = error.message;
      }
      const rootsValid = activeCheck?.ok !== false && previousCheck?.ok !== false && report.bindingsValid;
      report.gc = rootsValid
        ? await this._collectGarbageAfterCommit(commit)
        : { skipped: { reason: 'invalid-root' }, removedObjects: 0, keptObjects: 0, removedTemporary: 0, anomalies: [] };
      return report;
    }, breakStaleLock);
  }
}
