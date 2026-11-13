// sweepStaleTempFiles(): the temp files a killed refresh leaves (BR64-04).
//
// Only exact client temp names of trusted-state files, only for a pid that is not
// running, only regular files (checked without following links). Everything else in
// the directory is left alone.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  initClient,
  refreshClient,
  sweepStaleTempFiles,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import {
  bundleMirror,
  chainAtVersion,
  corpusFixture,
  METADATA_URL,
  writePrivate,
} from './client-fixtures.mjs';

const POSIX = process.platform !== 'win32';
const NOW = new Date('2026-09-27T19:45:00.000Z');

/** A pid that certainly belonged to a process and certainly has exited. */
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  });
  return Number(child.stdout);
}

async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-stale-temps-'));
  return dir;
}

test('temps of an exited process are removed, everything else stays', async () => {
  const dir = await directory();
  const dead = deadPid();
  const stale = [
    `.root.json.tmp-${dead}-1`,
    `.timestamp.json.tmp-${dead}-2`,
    `.snapshot.json.tmp-${dead}-3`,
    `.targets.json.tmp-${dead}-4`,
    `.rollback-reset.json.tmp-${dead}-5`,
  ];
  const kept = [
    'root.json',
    `.other.json.tmp-${dead}-1`, // not a trusted-state file of this client
    `.root.json.tmp-${dead}`, // no counter: not a name the client makes
    `.root.json.tmp-${dead}-1.bak`,
    `root.json.tmp-${dead}-1`, // no leading dot
    `.root.json.tmp-${process.pid}-9`, // this process
  ];
  for (const name of [...stale, ...kept]) await writePrivate(join(dir, name), Buffer.from(name));

  const removed = await sweepStaleTempFiles(dir);
  assert.deepEqual(removed, [...stale].sort());
  assert.deepEqual((await readdir(dir)).sort(), [...kept].sort());
  assert.deepEqual(await sweepStaleTempFiles(dir), [], 'idempotent');
});

test('a temp of a running process is never removed', async () => {
  const dir = await directory();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    await new Promise((resolve) => { child.once('spawn', resolve); });
    const live = `.targets.json.tmp-${child.pid}-1`;
    await writePrivate(join(dir, live), Buffer.from('in flight'));
    assert.deepEqual(await sweepStaleTempFiles(dir), []);
    assert.deepEqual(await readFile(join(dir, live)), Buffer.from('in flight'));
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => { child.once('exit', resolve); });
  }
});

test('a link or directory with a temp name is not removed or followed', { skip: !POSIX }, async () => {
  const dir = await directory();
  const dead = deadPid();
  const outside = join(await directory(), 'victim.json');
  await writePrivate(outside, Buffer.from('outside'));
  await symlink(outside, join(dir, `.root.json.tmp-${dead}-1`));
  await mkdir(join(dir, `.snapshot.json.tmp-${dead}-2`));

  assert.deepEqual(await sweepStaleTempFiles(dir), []);
  assert.deepEqual((await readdir(dir)).sort(), [
    `.root.json.tmp-${dead}-1`,
    `.snapshot.json.tmp-${dead}-2`,
  ]);
  assert.deepEqual(await readFile(outside), Buffer.from('outside'));
});

test('a refresh sweeps stale temps and reports them', async () => {
  const fx = await corpusFixture('browser-tuf-stale-temps-refresh-');
  const metadataDir = join(fx.dir, 'metadata');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writePrivate(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);
  const dead = deadPid();
  const stale = `.timestamp.json.tmp-${dead}-7`;
  await writePrivate(join(metadataDir, stale), Buffer.from('half written'));

  const result = await refreshClient({
    metadataDir,
    metadataUrl: METADATA_URL,
    now: NOW,
    fetchImpl: bundleMirror({ roots: [], ...chainAtVersion(fx, 3) }),
  });
  assert.equal(result.status, 'metadata-verified');
  assert.deepEqual(result.staleTempsRemoved, [stale]);
  assert.equal((await readdir(metadataDir)).includes(stale), false);
});
