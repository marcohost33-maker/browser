// Trusted state is read once, through one descriptor, and verified from those bytes
// (R46; threat model in spike/tuf-offline-metadata/client/THREAT-MODEL.md).
//
// Each swap below happens in the exact window the old path-based code left open,
// through the test seams of readTrustedFileOnce(). None of this claims an attack
// exists: same-account writers are inside the boundary, and the tests pin only what
// the code does when the object changes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsPromises, {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import {
  downloadTargets,
  loadTrustedState,
  readTrustedFileOnce,
  readTrustedRoleFiles,
  refreshClient,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import { parseTufMetadataBytes } from '../../spike/tuf-offline-metadata/strict-json.js';
import { sha256 } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import {
  bundleMirror,
  chainAtVersion,
  corpusFixture,
  METADATA_URL,
  writePrivate,
} from './client-fixtures.mjs';

const POSIX = process.platform !== 'win32';
const NOW = new Date('2026-09-27T19:45:00.000Z');
const ORIGINAL = Buffer.from('original bytes\n');
const OTHER = Buffer.from('another object with different bytes\n');

const hasCode = (code) => (error) => error?.code === code;

async function fixtureFile(name = 'file.json') {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-read-once-'));
  const path = join(dir, name);
  await writePrivate(path, ORIGINAL);
  return { dir, path };
}

const read = (path, probes = {}, extra = {}) => readTrustedFileOnce(path, {
  label: 'file.json',
  maxBytes: 1024,
  probes,
  ...extra,
});

// --- positive controls ------------------------------------------------------

test('an untouched file comes back byte for byte; a missing one is null', async () => {
  const { dir, path } = await fixtureFile();
  assert.deepEqual(await read(path), ORIGINAL);
  assert.equal(await read(join(dir, 'absent.json')), null);
});

test('reading past the limit yields limit + 1 bytes, so the caller\'s own check fires', async () => {
  const { path } = await fixtureFile();
  await writePrivate(path, Buffer.alloc(5000, 0x41));
  assert.equal((await read(path, {}, { maxBytes: 100 })).length, 101);
  assert.equal((await read(path, {}, { maxBytes: 5000 })).length, 5000);
  assert.equal((await read(path, {}, { maxBytes: 70000 })).length, 5000);
  await writePrivate(path, Buffer.alloc(0));
  assert.equal((await read(path)).length, 0);
});

// --- the window between check and open --------------------------------------

test('another regular file renamed in after the check is not read', async () => {
  const { dir, path } = await fixtureFile();
  const other = join(dir, 'other.json');
  await writePrivate(other, OTHER);
  await assert.rejects(
    read(path, { afterLstat: () => rename(other, path) }),
    hasCode('LOCAL_STATE_CHANGED'),
  );
  // Positive control: the same seam without a swap reads normally.
  const quiet = await fixtureFile();
  assert.deepEqual(await read(quiet.path, { afterLstat: async () => {} }), ORIGINAL);
});

test('a file removed after the check is absent, the state a deletion leaves', async () => {
  const { path } = await fixtureFile();
  assert.equal(await read(path, { afterLstat: () => unlink(path) }), null);
});

test('a link put in place after the check is refused, not followed', { skip: !POSIX }, async () => {
  const { dir, path } = await fixtureFile();
  const other = join(dir, 'other.json');
  await writePrivate(other, OTHER);
  await assert.rejects(
    read(path, {
      afterLstat: async () => {
        await unlink(path);
        await symlink(other, path);
      },
    }),
    hasCode('INSECURE_LOCAL_STATE'),
  );
});

test('a FIFO put in place after the check neither blocks nor is read', { skip: !POSIX }, async () => {
  const { path } = await fixtureFile();
  await assert.rejects(
    read(path, {
      afterLstat: async () => {
        await unlink(path);
        execFileSync('mkfifo', [path]);
      },
    }),
    hasCode('INSECURE_LOCAL_STATE'),
  );
});

test('rights opened up after the check are refused on the descriptor', { skip: !POSIX }, async () => {
  const { path } = await fixtureFile();
  await assert.rejects(
    read(path, { afterLstat: () => chmod(path, 0o666) }),
    (error) => error?.code === 'INSECURE_LOCAL_STATE' && /descriptor/.test(error.message),
  );
});

test('a hard link is the same object and is not treated as a swap', { skip: !POSIX }, async () => {
  const { dir, path } = await fixtureFile();
  await link(path, join(dir, 'alias.json'));
  assert.deepEqual(await read(path), ORIGINAL);
});

// --- the window while reading -----------------------------------------------

test('a file changed in place while it is read is refused', async () => {
  const { path } = await fixtureFile();
  await assert.rejects(
    read(path, { afterRead: () => writeFile(path, OTHER) }),
    hasCode('LOCAL_STATE_CHANGED'),
  );
});

test('the file is opened once and read through that descriptor only', async () => {
  const { path } = await fixtureFile();
  const realOpen = fsPromises.open;
  const realReadFile = fsPromises.readFile;
  let opens = 0;
  fsPromises.open = async (...args) => {
    opens += 1;
    return realOpen(...args);
  };
  fsPromises.readFile = async () => {
    throw new Error('a read by path is the window this function exists to close');
  };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await read(path), ORIGINAL);
  } finally {
    fsPromises.open = realOpen;
    fsPromises.readFile = realReadFile;
    syncBuiltinESMExports();
  }
  assert.equal(opens, 1);
});

// Windows refuses to rename over a file another handle holds open (EPERM, measured).
test('the bytes come from the descriptor: a replacement after the read has no effect', { skip: !POSIX }, async () => {
  const { dir, path } = await fixtureFile();
  const other = join(dir, 'other.json');
  await writePrivate(other, OTHER);
  const bytes = await read(path, { afterRead: () => rename(other, path) });
  assert.deepEqual(bytes, ORIGINAL, 'a second read of the path would have returned the new file');
  assert.deepEqual(await readFile(path), OTHER, 'the replacement did happen');
});

// --- one directory instance -------------------------------------------------

test('a metadata directory swapped between two role files is refused', async () => {
  const base = await mkdtemp(join(tmpdir(), 'browser-tuf-dir-swap-'));
  const metadataDir = join(base, 'metadata');
  await mkdir(metadataDir);
  await writePrivate(join(metadataDir, 'root.json'), ORIGINAL);
  const replacement = join(base, 'replacement');
  await mkdir(replacement);
  await writePrivate(join(replacement, 'root.json'), OTHER);

  await assert.rejects(
    readTrustedRoleFiles(metadataDir, undefined, {
      afterRole: async (role) => {
        if (role !== 'root') return;
        await rename(metadataDir, `${metadataDir}.old`);
        await rename(replacement, metadataDir);
      },
    }),
    hasCode('LOCAL_STATE_CHANGED'),
  );

  // Positive control: the same directory, nothing moved.
  const quiet = await readTrustedRoleFiles(metadataDir, undefined, {
    afterRole: async () => {},
  });
  assert.deepEqual(quiet.files.root, OTHER);
  assert.equal(quiet.files.timestamp, null);
  assert.equal(quiet.marker, null);
});

test('an oversized role file keeps the parser\'s own error', async () => {
  const fx = await corpusFixture('browser-tuf-read-once-size-');
  const metadataDir = join(fx.dir, 'metadata-size');
  await mkdir(metadataDir);
  await writePrivate(join(metadataDir, 'root.json'), fx.root);
  await assert.rejects(
    loadTrustedState(metadataDir, { metadataBytes: 16 }),
    hasCode('METADATA_TOO_LARGE'),
  );
});

// --- verification from the bytes that were read ------------------------------

test('a complete refresh reports the read-back digests of what it verified', async () => {
  const fx = await corpusFixture('browser-tuf-read-back-');
  const metadataDir = join(fx.dir, 'metadata');
  await mkdir(metadataDir);
  await writePrivate(join(metadataDir, 'root.json'), fx.root);
  const chain = chainAtVersion(fx, 7);
  const result = await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: bundleMirror(chain),
  });
  assert.equal(result.status, 'metadata-verified');
  assert.equal(result.readBack.status, 'verified-from-read-bytes');
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    assert.match(result.readBack.sha256[role], /^[0-9a-f]{64}$/);
  }
  assert.equal(result.readBack.sha256.targets, sha256(chain.targets));
});

// Runs `tamper` right after targets.json landed, the last write of a refresh
// without a reset, so the read-back is the first thing to see it.
async function afterTargetsLanded(tamper, action) {
  const original = fsPromises.rename;
  fsPromises.rename = async (from, to) => {
    await original(from, to);
    if (basename(String(to)) === 'targets.json') await tamper();
  };
  syncBuiltinESMExports();
  try {
    return await action();
  } finally {
    fsPromises.rename = original;
    syncBuiltinESMExports();
  }
}

async function freshClient(prefix) {
  const fx = await corpusFixture(prefix);
  const metadataDir = join(fx.dir, 'metadata');
  await mkdir(metadataDir);
  await writePrivate(join(metadataDir, 'root.json'), fx.root);
  return { fx, metadataDir };
}

test('a valid but different chain on disk after the run is refused by digest', async () => {
  const { fx, metadataDir } = await freshClient('browser-tuf-read-back-older-');
  const verified = chainAtVersion(fx, 7);
  const older = chainAtVersion(fx, 6);
  await assert.rejects(
    afterTargetsLanded(async () => {
      for (const role of ['timestamp', 'snapshot', 'targets']) {
        await writePrivate(join(metadataDir, `${role}.json`), older[role]);
      }
    }, () => refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: NOW,
      fetchImpl: bundleMirror(verified),
    })),
    (error) => error?.code === 'PERSISTED_STATE_UNVERIFIED' && /timestamp/.test(error.message),
  );
  // Control for the fixture: the older chain alone is a complete, valid chain, so
  // nothing but the digest comparison can tell it apart.
  const alone = await freshClient('browser-tuf-read-back-older-control-');
  const accepted = await refreshClient({
    metadataDir: alone.metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: bundleMirror(chainAtVersion(alone.fx, 6)),
  });
  assert.equal(accepted.status, 'metadata-verified');
});

test('a chain broken on disk after the run is refused, not reported as verified', async () => {
  const { fx, metadataDir } = await freshClient('browser-tuf-read-back-broken-');
  const chain = chainAtVersion(fx, 7);
  const foreign = chainAtVersion(fx, 8);
  await assert.rejects(
    afterTargetsLanded(
      () => writePrivate(join(metadataDir, 'targets.json'), foreign.targets),
      () => refreshClient({
        metadataDir,
        metadataUrl: METADATA_URL,
        now: NOW,
        fetchImpl: bundleMirror(chain),
      }),
    ),
    hasCode('PERSISTED_STATE_UNVERIFIED'),
  );
});

// downloadTargets reads the state once more after its refresh. That read is the
// last open of targets.json, counted on a control run rather than assumed.
async function downloadOf(metadataDir, chain, beforeOpen) {
  const realOpen = fsPromises.open;
  let opens = 0;
  fsPromises.open = async (...args) => {
    if (basename(String(args[0])) === 'targets.json') {
      opens += 1;
      await beforeOpen?.(opens);
    }
    return realOpen(...args);
  };
  syncBuiltinESMExports();
  try {
    await downloadTargets({
      metadataDir,
      metadataUrl: METADATA_URL,
      targetBaseUrl: 'https://mirror.example/targets/',
      targetDir: join(metadataDir, '..', 'downloads'),
      // Unknown on purpose: reaching this refusal means the state was authorised.
      targetNames: ['not/listed.bin'],
      now: NOW,
      fetchImpl: bundleMirror(chain),
    });
    assert.fail('an unlisted target must be refused');
  } catch (error) {
    return { error, opens };
  } finally {
    fsPromises.open = realOpen;
    syncBuiltinESMExports();
  }
}

test('a download authorises only from a chain it verified in that same read', async () => {
  const control = await freshClient('browser-tuf-download-control-');
  const measured = await downloadOf(control.metadataDir, chainAtVersion(control.fx, 7));
  assert.equal(measured.error.code, 'TARGET_NOT_FOUND');
  assert.ok(measured.opens >= 2, 'the refresh read-back and the download each read the file');

  const { fx, metadataDir } = await freshClient('browser-tuf-download-swapped-');
  const foreign = chainAtVersion(fx, 8).targets;
  let swapped = false;
  const { error } = await downloadOf(metadataDir, chainAtVersion(fx, 7), async (open) => {
    if (open === measured.opens && !swapped) {
      swapped = true;
      await writePrivate(join(metadataDir, 'targets.json'), foreign);
    }
  });
  assert.equal(swapped, true, 'the swap must happen, or this test shows nothing');
  assert.equal(error.code, 'PERSISTED_STATE_UNVERIFIED');
});

test('metadata expired on disk fails the read-back through the core verifier', async () => {
  const { fx, metadataDir } = await freshClient('browser-tuf-read-back-expired-');
  const chain = chainAtVersion(fx, 7);
  const result = await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: bundleMirror(chain),
  });
  assert.equal(result.status, 'metadata-verified');
  // Same bytes, an instant past their expiry: an equal timestamp re-verifies them.
  const expires = new Date(parseTufMetadataBytes(chain.timestamp).signed.expires);
  await assert.rejects(
    refreshClient({
      metadataDir,
      metadataUrl: METADATA_URL,
      now: new Date(expires.getTime() + 1000),
      fetchImpl: bundleMirror(chain),
    }),
    (error) => /EXPIRED/.test(String(error?.code)),
  );
});
