import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';

import {
  DEFAULT_LIMITS,
  TufSpikeError,
  validateTargetPath,
  verifyBootstrapRoot,
  verifyRetainedRoleMetadata,
  verifyTargetBytes,
} from '../tuf-offline.js';
import {
  parseTufMetadataBytes,
  verifyTopLevelMetadataBytes,
} from '../strict-json.js';

let tempCounter = 0;

export class TufClientError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TufClientError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new TufClientError(code, message, details);
}

function limitValue(limits, name) {
  const value = limits?.[name] ?? DEFAULT_LIMITS[name];
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('INVALID_LIMIT', `${name} must be a positive safe integer`);
  }
  return value;
}

async function readMaybe(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
    return true;
  } catch (error) {
    if (process.platform === 'win32'
        && ['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP'].includes(error?.code)) {
      return false;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Crash-safe single-file replacement: write same-directory temp, fsync the file,
 * rename atomically, then fsync the directory where the platform supports it.
 *
 * This is not a multi-file transaction and does not yet couple package activation
 * to metadata persistence.
 */
/**
 * mkdir({ recursive: true }) adds one directory entry to the parent of EVERY
 * directory it creates. Each of those entries is durable only after an fsync of
 * the directory that holds it, i.e. of every missing directory's parent, up to
 * and including the nearest pre-existing ancestor. Returns those parents
 * deepest-first; empty when `parent` already exists.
 *
 * Determined by walking up with lstat BEFORE mkdir rather than from mkdir's
 * return value, whose form is platform-specific (Windows returns a \\?\ path).
 * A directory created concurrently by someone else only adds a harmless extra
 * fsync; it can never drop one we need.
 */
async function parentsOfMissingDirectories(parent) {
  const parents = [];
  let dir = resolve(parent);
  while (true) {
    try {
      await lstat(dir);
      return parents;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const up = dirname(dir);
    if (up === dir) return parents;
    parents.push(up);
    dir = up;
  }
}

export async function atomicWriteFile(path, bytes) {
  const data = Buffer.from(bytes);
  const parent = dirname(path);
  const ancestorsToSync = await parentsOfMissingDirectories(parent);
  await mkdir(parent, { recursive: true });
  const directorySyncs = [];
  for (const directory of ancestorsToSync) {
    directorySyncs.push({ path: directory, synced: await syncDirectory(directory) });
  }

  const tempPath = join(
    parent,
    `.${basename(path)}.tmp-${process.pid}-${tempCounter += 1}`,
  );

  let handle;
  let renamed = false;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;

    await rename(tempPath, path);
    renamed = true;
    directorySyncs.push({ path: resolve(parent), synced: await syncDirectory(parent) });
    return {
      path,
      bytes: data.length,
      fileSynced: true,
      // true only if EVERY directory entry this call created or replaced was synced.
      directorySynced: directorySyncs.every((entry) => entry.synced),
      directorySyncs,
    };
  } finally {
    await handle?.close();
    if (!renamed) {
      try {
        await unlink(tempPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
}

function rolePath(metadataDir, role) {
  return join(metadataDir, `${role}.json`);
}

/**
 * A retained timestamp/snapshot is a rollback floor only while it still verifies
 * against the trusted root. TUF 1.0.35 section 5.3.11: "If the timestamp and / or
 * snapshot keys have been rotated, then delete the trusted timestamp and snapshot
 * metadata files." The core applies that reset when the rotation happens inside
 * one refresh; but root.json is persisted first (5.3.8), so a crash before the
 * new timestamp is written leaves old-key files next to the new root. Checking
 * them against the loaded root on every load makes the reset survive that crash
 * without a multi-file transaction: files signed by rotated-out keys are treated
 * as deleted (both of them, as 5.3.11 requires), exactly as if the refresh had
 * completed. Other failures (unreadable/invalid JSON) still fail closed.
 */
function retainedRollbackFloorValid(metadata, root, role, limits) {
  try {
    verifyRetainedRoleMetadata(metadata, root, role, limits);
    return true;
  } catch (error) {
    if (error instanceof TufSpikeError) return false;
    throw error;
  }
}

export async function loadTrustedState(metadataDir, limits = DEFAULT_LIMITS) {
  const rootBytes = await readMaybe(rolePath(metadataDir, 'root'));
  if (rootBytes === null) {
    fail('MISSING_TRUSTED_ROOT', 'metadata directory has no root.json');
  }
  const root = verifyBootstrapRoot(
    parseTufMetadataBytes(rootBytes, limits, 'trusted-root'),
    limits,
  );

  const timestampBytes = await readMaybe(rolePath(metadataDir, 'timestamp'));
  const snapshotBytes = await readMaybe(rolePath(metadataDir, 'snapshot'));
  const targetsBytes = await readMaybe(rolePath(metadataDir, 'targets'));

  if (snapshotBytes !== null && timestampBytes === null) {
    fail('INCOMPLETE_LOCAL_STATE', 'snapshot.json exists without timestamp.json');
  }
  if (targetsBytes !== null && snapshotBytes === null) {
    fail('INCOMPLETE_LOCAL_STATE', 'targets.json exists without snapshot.json');
  }

  const parsedTimestamp = timestampBytes === null
    ? null
    : parseTufMetadataBytes(timestampBytes, limits, 'trusted-timestamp');
  const parsedSnapshot = snapshotBytes === null
    ? null
    : parseTufMetadataBytes(snapshotBytes, limits, 'trusted-snapshot');
  const targets = targetsBytes === null
    ? null
    : parseTufMetadataBytes(targetsBytes, limits, 'trusted-targets');

  const rotatedOut = [
    ['timestamp', parsedTimestamp],
    ['snapshot', parsedSnapshot],
  ].filter(([role, metadata]) => (
    metadata !== null && !retainedRollbackFloorValid(metadata, root, role, limits)
  )).map(([role]) => role);
  const rollbackStateReset = rotatedOut.length > 0;
  const timestamp = rollbackStateReset ? null : parsedTimestamp;
  const snapshot = rollbackStateReset ? null : parsedSnapshot;

  return {
    trustedState: {
      root,
      versions: {
        timestamp: timestamp?.signed.version ?? 0,
        snapshot: snapshot?.signed.version ?? 0,
        targets: targets?.signed.version ?? 0,
      },
      snapshotMeta: snapshot?.signed.meta ?? {},
    },
    raw: {
      root: rootBytes,
      timestamp: rollbackStateReset ? null : timestampBytes,
      snapshot: rollbackStateReset ? null : snapshotBytes,
      targets: targetsBytes,
    },
    parsed: { root, timestamp, snapshot, targets },
    rollbackStateReset: rollbackStateReset ? { rotatedOut } : null,
  };
}

function baseUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_URL', `${label} is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    fail('INVALID_URL', `${label} must use http or https`);
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  url.search = '';
  url.hash = '';
  return url;
}

function childUrl(base, path) {
  return new URL(path.split('/').map(encodeURIComponent).join('/'), base).href;
}

export async function fetchBounded(
  url,
  {
    maxBytes,
    allowNotFound = false,
    timeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
  },
) {
  if (typeof fetchImpl !== 'function') fail('NO_FETCH', 'fetch implementation is unavailable');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('INVALID_LIMIT', 'maxBytes is invalid');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error' });
    if (response.status === 404 && allowNotFound) return null;
    if (!response.ok) {
      fail('HTTP_STATUS', `HTTP ${response.status} for ${url}`, { status: response.status, url });
    }

    const declared = response.headers.get('content-length');
    if (declared !== null) {
      const value = Number(declared);
      if (!Number.isSafeInteger(value) || value < 0 || value > maxBytes) {
        fail('DOWNLOAD_TOO_LARGE', `declared response exceeds limit for ${url}`);
      }
    }

    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Limit failure is authoritative even if transport cancellation fails.
        }
        fail('DOWNLOAD_TOO_LARGE', `response exceeds limit for ${url}`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error?.name === 'AbortError') {
      fail('DOWNLOAD_TIMEOUT', `request timed out for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function rootVersionFromRaw(bytes, limits) {
  return parseTufMetadataBytes(bytes, limits, 'root-candidate').signed.version;
}

async function fetchRootChain({
  metadataBase,
  startingVersion,
  limits,
  fetchBytes,
}) {
  const roots = [];
  let nextVersion = startingVersion + 1;
  const rootUpdateLimit = limitValue(limits, 'rootUpdates');
  for (let count = 0; count < rootUpdateLimit; count += 1, nextVersion += 1) {
    const bytes = await fetchBytes(
      childUrl(metadataBase, `${nextVersion}.root.json`),
      { maxBytes: limitValue(limits, 'metadataBytes'), allowNotFound: true },
    );
    if (bytes === null) return roots;

    const observedVersion = rootVersionFromRaw(bytes, limits);
    if (observedVersion !== nextVersion) {
      fail('ROOT_FILENAME_VERSION', 'root metadata version does not match requested filename', {
        expected: nextVersion,
        actual: observedVersion,
      });
    }
    roots.push(bytes);
  }
  return roots;
}

function consistentSnapshotFromRoots(trustedRoot, roots, limits) {
  if (roots.length === 0) return trustedRoot.signed.consistent_snapshot === true;
  const last = parseTufMetadataBytes(roots.at(-1), limits, 'root-candidate-final');
  return last.signed.consistent_snapshot === true;
}

function metadataFilename(role, version, consistentSnapshot) {
  if (!consistentSnapshot || role === 'timestamp') return `${role}.json`;
  return `${version}.${role}.json`;
}

async function persistVerifiedMetadata(metadataDir, verified, bundle) {
  const writes = [];

  if (bundle.roots.length > 0) {
    writes.push(await atomicWriteFile(rolePath(metadataDir, 'root'), bundle.roots.at(-1)));
  }

  if (verified.status === 'metadata-verified') {
    // Each role replacement is atomic. Cross-role transactionality is intentionally
    // not claimed yet; ordering preserves the normal TUF progression.
    writes.push(await atomicWriteFile(rolePath(metadataDir, 'timestamp'), bundle.timestamp));
    writes.push(await atomicWriteFile(rolePath(metadataDir, 'snapshot'), bundle.snapshot));
    writes.push(await atomicWriteFile(rolePath(metadataDir, 'targets'), bundle.targets));
  }

  return writes;
}

/**
 * An equal timestamp version ends the update cycle without new metadata
 * (TUF 1.0.35 section 5.4.3), after which the client keeps USING its retained
 * timestamp, snapshot and targets (5.7). Those must still be valid as final
 * metadata against the current trusted root: python-tuf keeps the old timestamp
 * and still raises ExpiredMetadataError from _check_final_timestamp(), and only
 * reuses local snapshot/targets that pass _check_final_snapshot() and the
 * targets signature/expiry checks. Without this, a repository or mirror that
 * keeps serving the same timestamp version past its expiry freezes the client
 * on stale targets (5.4.4/5.5.6/5.6.6 freeze protection).
 *
 * The retained files are re-run through the generic verifier with only the
 * timestamp rollback floor cleared, so no signature, hash, version or expiry
 * check is skipped; the snapshot/targets rollback floors stay in force.
 */
function assertRetainedMetadataFinal({ verified, local, now, limits }) {
  if (local.raw.timestamp === null || local.raw.snapshot === null || local.raw.targets === null) {
    fail('INCOMPLETE_LOCAL_STATE', 'no-update requires retained timestamp, snapshot and targets');
  }
  verifyTopLevelMetadataBytes({
    trustedState: {
      ...local.trustedState,
      root: verified.trustedState.root,
      versions: { ...local.trustedState.versions, timestamp: 0 },
    },
    bundle: {
      roots: [],
      timestamp: local.raw.timestamp,
      snapshot: local.raw.snapshot,
      targets: local.raw.targets,
    },
    now,
    limits,
  });
}

const TRUSTED_METADATA_ROLES = Object.freeze(['root', 'timestamp', 'snapshot', 'targets']);

async function existingTrustedMetadata(metadataDir) {
  const present = [];
  for (const role of TRUSTED_METADATA_ROLES) {
    try {
      await lstat(rolePath(metadataDir, role));
      present.push(`${role}.json`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return present;
}

/**
 * Bootstrap trust (TUF 5.2) into an EMPTY metadata directory.
 *
 * Replacing only root.json would keep timestamp/snapshot/targets and their
 * rollback versions from the previous trust domain; an equal-version timestamp
 * from the new repository would then yield no-update over those stale files.
 * Re-initialisation is therefore refused rather than silently merged; the
 * operator removes the old state explicitly.
 */
export async function initClient(metadataDir, trustedRootPath, limits = DEFAULT_LIMITS) {
  const trustedRootBytes = await readFile(trustedRootPath);
  const present = await existingTrustedMetadata(metadataDir);
  if (present.length > 0) {
    fail('METADATA_DIR_INITIALIZED', 'metadata directory already holds trusted state', {
      metadataDir,
      present,
    });
  }
  // Fail closed BEFORE anything is persisted: the file must be a strict-JSON TUF
  // root of this POUF that is signed by a threshold of its own root keys.
  verifyBootstrapRoot(parseTufMetadataBytes(trustedRootBytes, limits, 'trusted-root'), limits);
  return atomicWriteFile(rolePath(metadataDir, 'root'), trustedRootBytes);
}

/**
 * Codes that mean "the retained snapshot/targets are not the files the trusted
 * timestamp/snapshot pin" - the signature of persistence interrupted between two
 * role files (single-file crash safety only). Re-downloading can repair exactly
 * this; for anything else (expiry, signatures) the pinned bytes would be the same,
 * so the original error stands.
 */
const INTERRUPTED_PERSISTENCE_CODES = Object.freeze(new Set([
  'INCOMPLETE_LOCAL_STATE',
  'METADATA_LENGTH',
  'METADATA_HASH',
  'SNAPSHOT_VERSION',
  'TARGETS_VERSION',
]));

async function fetchSnapshotAndTargets({
  metadataBase,
  snapshotVersion,
  consistentSnapshot,
  limits,
  fetchBytes,
}) {
  const snapshot = await fetchBytes(
    childUrl(metadataBase, metadataFilename('snapshot', snapshotVersion, consistentSnapshot)),
    { maxBytes: limitValue(limits, 'metadataBytes') },
  );

  const parsedSnapshot = parseTufMetadataBytes(snapshot, limits, 'remote-snapshot');
  const targetsDescriptor = parsedSnapshot.signed.meta?.['targets.json'];
  if (!targetsDescriptor || !Number.isSafeInteger(targetsDescriptor.version)) {
    fail('INVALID_SNAPSHOT_META', 'snapshot does not provide targets version');
  }

  const targets = await fetchBytes(
    childUrl(metadataBase, metadataFilename(
      'targets',
      targetsDescriptor.version,
      consistentSnapshot,
    )),
    { maxBytes: limitValue(limits, 'metadataBytes') },
  );
  return { snapshot, targets };
}

/**
 * Equal timestamp version (5.4.3.1): the new timestamp is discarded and the
 * TRUSTED one stays in use. If the retained snapshot/targets are not the files it
 * pins (persistence was interrupted after timestamp.json), complete the update
 * from that trusted timestamp (5.5/5.6) instead of failing until the repository
 * happens to publish a newer timestamp. The trusted timestamp is re-verified in
 * full by the generic core (only its own equal-version floor is lifted); the
 * snapshot/targets rollback floors stay in force.
 */
async function finishNoUpdate({
  verified,
  local,
  metadataDir,
  metadataBase,
  consistentSnapshot,
  now,
  limits,
  fetchBytes,
}) {
  try {
    assertRetainedMetadataFinal({ verified, local, now, limits });
    return null;
  } catch (error) {
    if (!INTERRUPTED_PERSISTENCE_CODES.has(error?.code) || local.parsed.timestamp === null) {
      throw error;
    }
    try {
      verifyRetainedRoleMetadata(
        local.parsed.timestamp,
        verified.trustedState.root,
        'timestamp',
        limits,
        { now },
      );
    } catch {
      throw error;
    }
  }

  const snapshotDescriptor = local.parsed.timestamp.signed.meta?.['snapshot.json'];
  if (!snapshotDescriptor || !Number.isSafeInteger(snapshotDescriptor.version)) {
    fail('INVALID_TIMESTAMP_META', 'trusted timestamp does not provide snapshot version');
  }
  const { snapshot, targets } = await fetchSnapshotAndTargets({
    metadataBase,
    snapshotVersion: snapshotDescriptor.version,
    consistentSnapshot,
    limits,
    fetchBytes,
  });
  const bundle = { roots: [], timestamp: local.raw.timestamp, snapshot, targets };
  const resumed = verifyTopLevelMetadataBytes({
    trustedState: {
      ...local.trustedState,
      root: verified.trustedState.root,
      versions: { ...local.trustedState.versions, timestamp: 0 },
    },
    bundle,
    now,
    limits,
  });
  const writes = await persistVerifiedMetadata(metadataDir, resumed, bundle);
  return { verified: resumed, writes };
}

export async function refreshClient({
  metadataDir,
  metadataUrl,
  now = new Date(),
  limits = DEFAULT_LIMITS,
  fetchImpl = globalThis.fetch,
}) {
  const local = await loadTrustedState(metadataDir, limits);
  const metadataBase = baseUrl(metadataUrl, 'metadata URL');
  const fetchBytes = (url, options) => fetchBounded(url, { ...options, fetchImpl });

  const roots = await fetchRootChain({
    metadataBase,
    startingVersion: local.parsed.root.signed.version,
    limits,
    fetchBytes,
  });

  const timestamp = await fetchBytes(childUrl(metadataBase, 'timestamp.json'), {
    maxBytes: limitValue(limits, 'metadataBytes'),
  });
  const parsedTimestamp = parseTufMetadataBytes(timestamp, limits, 'remote-timestamp');
  const snapshotDescriptor = parsedTimestamp.signed.meta?.['snapshot.json'];
  if (!snapshotDescriptor || !Number.isSafeInteger(snapshotDescriptor.version)) {
    fail('INVALID_TIMESTAMP_META', 'timestamp does not provide snapshot version');
  }

  const consistentSnapshot = consistentSnapshotFromRoots(local.parsed.root, roots, limits);
  const finish = (verified) => finishNoUpdate({
    verified,
    local,
    metadataDir,
    metadataBase,
    consistentSnapshot,
    now,
    limits,
    fetchBytes,
  });

  // With no root transition, an equal timestamp is a complete no-update signal
  // after its signature/rollback checks. Use the existing local snapshot/targets
  // as inert bundle members so we do not make unnecessary repository requests.
  // A lower timestamp still reaches the verifier and fails rollback closed.
  if (roots.length === 0
      && local.raw.snapshot !== null
      && local.raw.targets !== null
      && parsedTimestamp.signed.version <= local.trustedState.versions.timestamp) {
    const bundle = {
      roots,
      timestamp,
      snapshot: local.raw.snapshot,
      targets: local.raw.targets,
    };
    const verified = verifyTopLevelMetadataBytes({
      trustedState: local.trustedState,
      bundle,
      now,
      limits,
    });
    const writes = await persistVerifiedMetadata(metadataDir, verified, bundle);
    return completeRefresh({ verified, writes, finish, consistentSnapshot });
  }
  const { snapshot, targets } = await fetchSnapshotAndTargets({
    metadataBase,
    snapshotVersion: snapshotDescriptor.version,
    consistentSnapshot,
    limits,
    fetchBytes,
  });

  const bundle = { roots, timestamp, snapshot, targets };
  const verified = verifyTopLevelMetadataBytes({
    trustedState: local.trustedState,
    bundle,
    now,
    limits,
  });

  // Root progress is already persisted (5.3.8) before the retained
  // snapshot/targets are checked against that root in finishNoUpdate().
  const writes = await persistVerifiedMetadata(metadataDir, verified, bundle);
  return completeRefresh({ verified, writes, finish, consistentSnapshot });
}

async function completeRefresh({ verified, writes, finish, consistentSnapshot }) {
  const resumed = verified.status === 'no-update' ? await finish(verified) : null;
  if (resumed === null) {
    return { ...verified, writes, consistentSnapshot };
  }
  return {
    ...resumed.verified,
    resumedFromTrustedTimestamp: true,
    writes: [...writes, ...resumed.writes],
    consistentSnapshot,
  };
}

function targetFetchPath(targetPath, descriptor, consistentSnapshot, limits) {
  // Same configured limits as refresh validation; the default-only call here
  // rejected signed targets that the caller's raised limits admit.
  validateTargetPath(targetPath, limits);
  if (!consistentSnapshot) return targetPath;

  const digest = descriptor?.hashes?.sha256;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    fail('INVALID_TARGET_DESCRIPTOR', 'consistent-snapshot target requires SHA-256');
  }
  const components = targetPath.split('/');
  components[components.length - 1] = `${digest}.${components.at(-1)}`;
  return components.join('/');
}

async function readVerifiedCachedTarget(path, descriptor, limits) {
  const bytes = await readMaybe(path);
  if (bytes === null) return null;
  try {
    return verifyTargetBytes(bytes, descriptor, limits);
  } catch {
    return null;
  }
}

export async function downloadTargets({
  metadataDir,
  metadataUrl,
  targetBaseUrl,
  targetDir,
  targetNames,
  now = new Date(),
  limits = DEFAULT_LIMITS,
  fetchImpl = globalThis.fetch,
}) {
  if (!Array.isArray(targetNames) || targetNames.length === 0) {
    fail('TARGET_REQUIRED', 'at least one target name is required');
  }

  const refresh = await refreshClient({
    metadataDir,
    metadataUrl,
    now,
    limits,
    fetchImpl,
  });
  const local = await loadTrustedState(metadataDir, limits);
  if (local.parsed.targets === null) fail('MISSING_TARGETS', 'trusted targets metadata is unavailable');

  const targetBase = baseUrl(targetBaseUrl, 'target base URL');
  const downloaded = [];

  for (const targetName of targetNames) {
    validateTargetPath(targetName, limits);
    const descriptor = local.parsed.targets.signed.targets?.[targetName];
    if (!descriptor) fail('TARGET_NOT_FOUND', `target is not authorized: ${targetName}`);

    const outputPath = join(targetDir, ...targetName.split('/'));
    const cached = await readVerifiedCachedTarget(outputPath, descriptor, limits);
    if (cached !== null) {
      downloaded.push({ targetName, outputPath, cached: true, bytes: cached.length });
      continue;
    }

    const remotePath = targetFetchPath(
      targetName,
      descriptor,
      refresh.consistentSnapshot,
      limits,
    );
    const bytes = await fetchBounded(childUrl(targetBase, remotePath), {
      maxBytes: limitValue(limits, 'targetBytes'),
      fetchImpl,
    });
    // Persist exactly the private copy that was hashed (verifyTargetBytes).
    const verifiedBytes = verifyTargetBytes(bytes, descriptor, limits);
    const write = await atomicWriteFile(outputPath, verifiedBytes);
    downloaded.push({
      targetName,
      outputPath,
      cached: false,
      bytes: verifiedBytes.length,
      write,
    });
  }

  return { refresh, downloaded };
}
