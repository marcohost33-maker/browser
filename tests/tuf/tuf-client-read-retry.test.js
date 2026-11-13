// Bounded, fresh re-read after LOCAL_STATE_CHANGED (BR64-02, cross-family review of
// #64: "a controlled, bounded retry may only read again completely and fresh, without
// failing open").
//
// The single-read refusal itself is pinned in tuf-client-read-once.test.js. These
// tests pin what loadTrustedState() does with it: retry the WHOLE read (directory
// rules included), keep nothing from the refused attempt, give up after three
// attempts, and never retry anything but a concurrent change.
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  initClient,
  loadTrustedState,
  refreshClient,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import {
  bundleMirror,
  chainAtVersion,
  corpusFixture,
  writePrivate,
} from './client-fixtures.mjs';

const POSIX = process.platform !== 'win32';
const NOW = new Date('2026-09-27T19:45:00.000Z');
const METADATA_URL = 'https://repo.test/metadata/';
const hasCode = (code) => (error) => error?.code === code;

async function clientAtV2(prefix) {
  const fx = await corpusFixture(prefix);
  const metadataDir = join(fx.dir, 'metadata');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);
  await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: bundleMirror({
      roots: [], timestamp: fx.timestamp, snapshot: fx.snapshot, targets: fx.targets,
    }),
  });
  return { fx, metadataDir };
}

/** What another process's refresh does: atomic replacement of each role file. */
async function replaceAtomically(metadataDir, role, bytes) {
  const temp = join(metadataDir, `.${role}.json.concurrent`);
  await writePrivate(temp, bytes);
  await rename(temp, join(metadataDir, `${role}.json`));
}

// A timestamp taken now must differ from the fixture's (coarse kernel clocks).
const pastTimestampTick = () => delay(50);

/** Probes that know which attempt is running. */
function attemptProbes(onFileRead) {
  const seen = { attempts: [] };
  return {
    seen,
    probes: {
      beforeAttempt: (attempt) => { seen.attempts.push(attempt); },
      file: { afterRead: () => onFileRead(seen.attempts.at(-1)) },
    },
  };
}

test('a whole concurrent refresh during the read is refused once, then read fresh', { skip: !POSIX }, async () => {
  const { fx, metadataDir } = await clientAtV2('browser-tuf-retry-fresh-');
  const v3 = chainAtVersion(fx, 3);
  await pastTimestampTick();
  let done = false;
  const { seen, probes } = attemptProbes(async (attempt) => {
    if (attempt !== 1 || done) return;
    done = true;
    // During the read of root.json in attempt 1, another process lands v3.
    await replaceAtomically(metadataDir, 'root', fx.root);
    for (const role of ['timestamp', 'snapshot', 'targets']) {
      await replaceAtomically(metadataDir, role, v3[role]);
    }
  });

  const loaded = await loadTrustedState(metadataDir, undefined, probes);
  assert.deepEqual(seen.attempts, [1, 2]);
  assert.equal(loaded.readAttempts, 2);
  // Fresh: every role is the v3 file, nothing survived from the refused attempt.
  assert.deepEqual(loaded.trustedState.versions, { timestamp: 3, snapshot: 3, targets: 3 });
  for (const role of ['timestamp', 'snapshot', 'targets']) {
    assert.deepEqual(loaded.raw[role], v3[role], role);
  }

  // Positive control: no concurrent writer, one attempt.
  const quiet = await loadTrustedState(metadataDir);
  assert.equal(quiet.readAttempts, 1);
});

test('a change on every attempt fails closed after three attempts', async () => {
  const { metadataDir } = await clientAtV2('browser-tuf-retry-bounded-');
  const rootPath = join(metadataDir, 'root.json');
  const root = await readFile(rootPath);
  await pastTimestampTick();
  const changedInPlace = [];
  const { seen, probes } = attemptProbes(async (attempt) => {
    if (changedInPlace.includes(attempt)) return;
    changedInPlace.push(attempt);
    await writeFile(rootPath, root); // same bytes, new mtime/ctime: a change
    await pastTimestampTick();
  });

  await assert.rejects(
    loadTrustedState(metadataDir, undefined, probes),
    (error) => error?.code === 'LOCAL_STATE_CHANGED' && error.details?.attempts === 3,
  );
  assert.deepEqual(seen.attempts, [1, 2, 3], 'bounded: exactly three full attempts');
});

test('an insecure object is refused on the first attempt, never retried', { skip: !POSIX }, async () => {
  const { metadataDir } = await clientAtV2('browser-tuf-retry-insecure-');
  const { seen, probes } = attemptProbes(() => {});
  probes.file.afterLstat = () => chmod(join(metadataDir, 'timestamp.json'), 0o666);
  await assert.rejects(
    loadTrustedState(metadataDir, undefined, probes),
    hasCode('INSECURE_LOCAL_STATE'),
  );
  assert.deepEqual(seen.attempts, [1]);
});

test('a retry re-checks a directory that was replaced in between', { skip: !POSIX }, async () => {
  const { metadataDir } = await clientAtV2('browser-tuf-retry-directory-');
  const replacement = `${metadataDir}.replacement`;
  await mkdir(replacement);
  for (const role of ['root', 'timestamp', 'snapshot', 'targets']) {
    await writePrivate(join(replacement, `${role}.json`), await readFile(join(metadataDir, `${role}.json`)));
  }
  // Same bytes, but the replacement directory is writable by everyone.
  await chmod(replacement, 0o777);

  let swapped = false;
  const { seen, probes } = attemptProbes(() => {});
  probes.afterRole = async (role) => {
    if (swapped || role !== 'root') return;
    swapped = true;
    await rename(metadataDir, `${metadataDir}.old`);
    await rename(replacement, metadataDir);
  };

  await assert.rejects(
    loadTrustedState(metadataDir, undefined, probes),
    (error) => error?.code === 'INSECURE_LOCAL_STATE' && /writable by group or others/.test(error.message),
  );
  // Attempt 1 saw the directory change; attempt 2 refused the replacement in its own
  // boundary check, before any file of it was read, and was not retried.
  assert.deepEqual(seen.attempts, [1, 2]);
});
