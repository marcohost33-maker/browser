// The target cache of `download`: what counts as a cache hit, and which leftovers
// of a killed download are removed. Companion of tuf-client-download-kill.test.js,
// which reaches these paths through real kills; here each rule is pinned on its own.
//
// The target directory is the caller's, not trusted state (THREAT-MODEL.md). The
// rules here do not defend it against its owner; they keep the client from being
// blocked, from loading foreign data into memory, and from collecting garbage.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  downloadTargets,
  initClient,
  sweepStaleTargetTemps,
} from '../../spike/tuf-offline-metadata/client/client-core.mjs';
import {
  bundleMirror,
  corpusFixture,
  METADATA_URL,
} from './client-fixtures.mjs';

const WORKER = fileURLToPath(new URL('./process-kill-worker.mjs', import.meta.url));
const POSIX = process.platform !== 'win32';
const NOW = new Date('2026-09-27T19:45:00.000Z');
const TARGET_URL = 'https://repo.test/targets/';
const TARGET_NAME = 'artifacts/demo.bin';
const TARGET = Buffer.from('oracle-target-v2', 'utf8'); // the corpus descriptor

/** A pid that certainly belonged to a process and certainly has exited. */
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  });
  return Number(child.stdout);
}

async function client(prefix) {
  const fx = await corpusFixture(prefix);
  const metadataDir = join(fx.dir, 'metadata');
  const targetDir = join(fx.dir, 'targets');
  const sourceRoot = join(fx.dir, 'source-root.json');
  await writeFile(sourceRoot, fx.root);
  await initClient(metadataDir, sourceRoot);
  const metadata = bundleMirror({
    roots: [], timestamp: fx.timestamp, snapshot: fx.snapshot, targets: fx.targets,
  });
  const counter = { targetRequests: 0 };
  const download = () => downloadTargets({
    metadataDir,
    metadataUrl: METADATA_URL,
    targetBaseUrl: TARGET_URL,
    targetDir,
    targetNames: [TARGET_NAME],
    now: NOW,
    fetchImpl: async (url) => {
      if (!String(url).startsWith(TARGET_URL)) return metadata(url);
      counter.targetRequests += 1;
      return new Response(TARGET, { status: 200, headers: { 'content-length': String(TARGET.length) } });
    },
  });
  const artifacts = join(targetDir, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  return { fx, download, counter, artifacts, outputPath: join(artifacts, 'demo.bin') };
}

test('a download removes the temps a killed download left beside its target, and only those', async () => {
  const { download, artifacts, outputPath } = await client('browser-tuf-target-sweep-');
  const dead = deadPid();
  const stale = [`.demo.bin.tmp-${dead}-1`, `.demo.bin.tmp-${dead}-27`];
  const kept = [
    `.other.bin.tmp-${dead}-1`, // another target's temp: not this download's to judge
    `.demoXbin.tmp-${dead}-1`, // the dot in the name is literal
    `.demo.bin.tmp-${dead}`, // no counter: not a name the client makes
    `.demo.bin.tmp-${dead}-1.bak`,
    `demo.bin.tmp-${dead}-1`, // no leading dot
    `.demo.bin.tmp-${process.pid}-9`, // this process
    'unrelated.txt',
  ];
  for (const name of [...stale, ...kept]) await writeFile(join(artifacts, name), name);

  const result = await download();
  assert.deepEqual(result.downloaded[0].staleTempsRemoved, stale);
  assert.equal(result.downloaded[0].cached, false);
  assert.deepEqual((await readdir(artifacts)).sort(), [...kept, 'demo.bin'].sort());
  assert.deepEqual(await readFile(outputPath), TARGET);

  // The cache-hit path sweeps too: a kill can leave a temp beside a valid target.
  await writeFile(join(artifacts, stale[0]), 'again');
  const second = await download();
  assert.equal(second.downloaded[0].cached, true);
  assert.deepEqual(second.downloaded[0].staleTempsRemoved, [stale[0]]);
});

test('the target sweep never follows a link, never removes a directory, and tolerates a missing directory', {
  skip: !POSIX && 'symlinks need privileges on Windows',
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-tuf-target-sweep-rules-'));
  const dead = deadPid();
  const victim = join(dir, 'victim.txt');
  await writeFile(victim, 'keep me');
  await symlink(victim, join(dir, `.demo.bin.tmp-${dead}-1`));
  await mkdir(join(dir, `.demo.bin.tmp-${dead}-2`));

  assert.deepEqual(await sweepStaleTargetTemps(join(dir, 'demo.bin')), []);
  assert.equal((await readFile(victim, 'utf8')), 'keep me');
  assert.equal((await readdir(dir)).length, 3);

  assert.deepEqual(await sweepStaleTargetTemps(join(dir, 'absent', 'demo.bin')), []);
  assert.deepEqual(await sweepStaleTargetTemps(join(victim, 'demo.bin')), [], 'a file where a directory is expected');
});

test('a link at the output path is never a cache hit; the target replaces the link, not what it points to', {
  skip: !POSIX && 'O_NOFOLLOW is POSIX',
}, async () => {
  const { fx, download, counter, outputPath } = await client('browser-tuf-target-link-');
  // The link points at the exactly right bytes: only the link itself disqualifies it.
  const elsewhere = join(fx.dir, 'elsewhere.bin');
  await writeFile(elsewhere, TARGET);
  await symlink(elsewhere, outputPath);

  const result = await download();
  assert.equal(result.downloaded[0].cached, false, 'a link was accepted as the cached target');
  assert.equal(counter.targetRequests, 1);
  assert.equal((await lstat(outputPath)).isFile(), true, 'the output path is still a link');
  assert.deepEqual(await readFile(outputPath), TARGET);
  assert.deepEqual(await readFile(elsewhere), TARGET);
});

test('a FIFO at the output path does not block the download', {
  skip: !POSIX && 'FIFOs are POSIX',
}, async () => {
  const { fx, counter, outputPath } = await client('browser-tuf-target-fifo-');
  assert.equal(counter.targetRequests, 0);
  execFileSync('mkfifo', [outputPath]);

  // In a child with a hard time limit: a blocking open of a FIFO parks a thread
  // for good and keeps this process alive past any test timeout. Without the
  // limit, a client (or a mutant of it) that blocks would hang the whole suite
  // instead of failing this test.
  const spec = join(fx.dir, 'fifo-spec.json');
  const out = join(fx.dir, 'fifo-out.json');
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  await writeFile(spec, JSON.stringify({
    mode: 'download',
    metadataDir: join(fx.dir, 'metadata'),
    targetDir: join(fx.dir, 'targets'),
    targetName: TARGET_NAME,
    now: NOW.toISOString(),
    mirror: {
      roots: [], timestamp: b64(fx.timestamp), snapshot: b64(fx.snapshot), targets: b64(fx.targets),
    },
    targetBytes: b64(TARGET),
    killAt: null,
    log: join(fx.dir, 'fifo-steps.log'),
    out,
  }));
  const run = spawnSync(process.execPath, [WORKER, spec], {
    encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL',
  });
  assert.equal(run.signal, null, 'the download blocked on the FIFO and had to be killed');
  assert.equal(run.status, 0, run.stderr);

  const result = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(result.cached, false);
  assert.equal(result.targetRequests, 1);
  assert.equal((await lstat(outputPath)).isFile(), true);
  assert.deepEqual(await readFile(outputPath), TARGET);
});

test('a huge file at the output path is not read into memory to learn it is not the target', {
  skip: !POSIX && 'sparse file via ftruncate; NTFS would allocate it',
}, async () => {
  const { download, counter, outputPath } = await client('browser-tuf-target-huge-');
  // Larger than any buffer Node will allocate for readFile (2 GiB): a client that
  // reads the whole file before checking it fails here instead of replacing it.
  const handle = await open(outputPath, 'w');
  await handle.truncate(2 ** 31 + 1);
  await handle.close();

  const result = await download();
  assert.equal(result.downloaded[0].cached, false);
  assert.equal(counter.targetRequests, 1);
  assert.deepEqual(await readFile(outputPath), TARGET);
});

test('a file of the right length but other bytes is replaced, and the right bytes are a cache hit', async () => {
  const { download, counter, outputPath } = await client('browser-tuf-target-bytes-');
  await writeFile(outputPath, Buffer.alloc(TARGET.length, 0x41));

  const first = await download();
  assert.equal(first.downloaded[0].cached, false);
  assert.deepEqual(await readFile(outputPath), TARGET);

  const second = await download();
  assert.equal(second.downloaded[0].cached, true);
  assert.equal(second.downloaded[0].bytes, TARGET.length);
  assert.equal(counter.targetRequests, 1);
});
