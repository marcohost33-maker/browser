// Child process of tests/tuf/tuf-client-process-kill.test.js (BR64-04).
//
//   node tests/tuf/process-kill-worker.mjs <spec.json>
//
// Mode `refresh`: runs one refreshClient() against a fixed mirror. Every call that
// can change the metadata directory or make it durable is a numbered step:
//
//   mkdir, create (open 'wx' of the temp file), write, fsync (file), rename,
//   fsync-dir (the directory sync after a rename), unlink
//
// Each step is appended to `spec.log` with a synchronous write BEFORE it runs. With
// `killAt = k` (1..N) the process sends itself SIGKILL instead of running step k; with
// `killAt = N + 1` it does so right after step N returns. That is a real process
// death at that instruction: no finally block, no handle close, no temp cleanup.
// The kernel keeps what was written (page cache), so this is the process-crash
// model, not power loss.
//
// Mode `after-crash`: a fresh process that first OBSERVES the directory exactly as
// the killed process left it (no write before the observation), then replays the
// old bundle against a copy, then recovers with the new bundle, twice.
//
// This file is not a test (no `.test.js`), so `node --test tests/tuf/*.test.js`
// only runs it through the test that spawns it.
import { appendFileSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import fsPromises, { cp, readdir, readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, relative, resolve } from 'node:path';

import { sha256 } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import { bundleMirror, decode } from './client-fixtures.mjs';

const ROLES = Object.freeze(['root', 'timestamp', 'snapshot', 'targets']);
const MARKER = 'rollback-reset.json';
const TEMP_NAME = /^\.(.+)\.tmp-\d+-\d+$/;

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const now = new Date(spec.now);
const mirrorOf = (bundle) => bundleMirror({
  roots: bundle.roots.map(decode),
  timestamp: decode(bundle.timestamp),
  snapshot: decode(bundle.snapshot),
  targets: decode(bundle.targets),
});

// Names without pid/counter, so the step sequence is identical across runs.
function stepName(path) {
  if (resolve(String(path)) === resolve(spec.metadataDir)) return '<metadata-dir>';
  const name = basename(String(path));
  const temp = TEMP_NAME.exec(name);
  return temp ? `.${temp[1]}.tmp` : name;
}

function die() {
  process.kill(process.pid, 'SIGKILL');
  // SIGKILL to oneself is delivered before this returns to user space; if it were
  // not, block forever rather than run one more instruction of the refresh.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

// Exact operation record for the power-loss model (tests/tuf/power-loss-model.mjs):
// names relative to the metadata directory, written bytes included. Only written
// when `spec.opsLog` is set (the uninterrupted trace run).
function recordOp(op) {
  if (!spec.opsLog) return;
  appendFileSync(spec.opsLog, `${JSON.stringify(op)}\n`);
}
const inMetadata = (path) => relative(resolve(spec.metadataDir), resolve(String(path))) || '.';

function instrument({ killAt, log }) {
  let step = 0;
  const stepBefore = (label) => {
    step += 1;
    appendFileSync(log, `${JSON.stringify({ step, label })}\n`);
    if (killAt === step) {
      appendFileSync(log, `${JSON.stringify({ killed: 'before', step, label })}\n`);
      die();
    }
    return step;
  };
  const stepAfter = (current, label) => {
    if (killAt === current + 1 && spec.total === current) {
      appendFileSync(log, `${JSON.stringify({ killed: 'after', step: current, label })}\n`);
      die();
    }
  };
  const around = (label, fn) => async (...args) => {
    const current = stepBefore(label);
    let result;
    try {
      result = await fn(...args);
    } catch (error) {
      // A step that failed (for instance unlink of an absent marker, ENOENT) is
      // still a kill point, but it changed nothing: say so for the drift guard.
      appendFileSync(log, `${JSON.stringify({ failed: current, label, code: error?.code ?? null })}\n`);
      throw error;
    }
    stepAfter(current, label);
    return result;
  };

  const real = {
    mkdir: fsPromises.mkdir,
    open: fsPromises.open,
    rename: fsPromises.rename,
    unlink: fsPromises.unlink,
  };
  fsPromises.mkdir = (path, ...rest) => around(`mkdir ${stepName(path)}`, async (...args) => {
    const result = await real.mkdir(...args);
    recordOp({ op: 'mkdir', name: inMetadata(path) });
    return result;
  })(path, ...rest);
  fsPromises.rename = (from, to) => around(
    `rename ${stepName(from)} -> ${stepName(to)}`,
    async (a, b) => {
      await real.rename(a, b);
      recordOp({ op: 'rename', from: inMetadata(a), to: inMetadata(b) });
    },
  )(from, to);
  fsPromises.unlink = (path) => around(`unlink ${stepName(path)}`, async (target) => {
    await real.unlink(target);
    recordOp({ op: 'unlink', name: inMetadata(target) });
  })(path);
  fsPromises.open = async (path, flags, ...rest) => {
    // Any open that can create or truncate is a step: 'wx' is the client's temp
    // file; other write flags only occur in mutants of the mutation study.
    if (typeof flags === 'string' && /[wa+]/.test(flags)) {
      const handle = await around(`create ${stepName(path)}`, real.open)(path, flags, ...rest);
      const name = stepName(path);
      const exact = inMetadata(path);
      recordOp({ op: 'open-write', name: exact, exclusive: flags.includes('x') });
      const writeFile = handle.writeFile.bind(handle);
      const sync = handle.sync.bind(handle);
      handle.writeFile = around(`write ${name}`, async (data, ...more) => {
        await writeFile(data, ...more);
        recordOp({ op: 'write', name: exact, data: Buffer.from(data).toString('base64') });
      });
      handle.sync = around(`fsync ${name}`, async () => {
        await sync();
        recordOp({ op: 'fsync', name: exact });
      });
      return handle;
    }
    const handle = await real.open(path, flags, ...rest);
    if (flags === 'r' && lstatSync(path).isDirectory()) {
      const sync = handle.sync.bind(handle);
      handle.sync = around(`fsync-dir ${stepName(path)}`, async () => {
        await sync();
        recordOp({ op: 'fsync-dir', name: inMetadata(path) });
      });
    }
    return handle;
  };
  syncBuiltinESMExports();
}

async function snapshotDirectory(dir) {
  const files = {};
  for (const role of ROLES) {
    try {
      files[role] = sha256(await readFile(`${dir}/${role}.json`));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      files[role] = null;
    }
  }
  const names = await readdir(dir);
  return {
    files,
    marker: names.includes(MARKER)
      ? (await readFile(`${dir}/${MARKER}`, 'utf8')).trim()
      : null,
    temps: names.filter((name) => TEMP_NAME.test(name)).sort(),
  };
}

const outcome = (promise) => promise.then(
  (value) => ({ ok: true, value }),
  (error) => ({
    ok: false,
    code: error?.code ?? null,
    name: error?.name,
    message: error?.message,
    details: error?.details ?? null,
  }),
);

async function main() {
  if (spec.mode === 'refresh') {
    instrument({ killAt: spec.killAt ?? null, log: spec.log });
    const { refreshClient } = await import('../../spike/tuf-offline-metadata/client/client-core.mjs');
    const result = await refreshClient({
      metadataDir: spec.metadataDir,
      metadataUrl: 'https://repo.test/metadata/',
      now,
      fetchImpl: mirrorOf(spec.mirror),
    });
    writeFileSync(spec.out, JSON.stringify({ status: result.status }));
    return;
  }

  if (spec.mode === 'init') {
    instrument({ killAt: spec.killAt ?? null, log: spec.log });
    const { initClient } = await import('../../spike/tuf-offline-metadata/client/client-core.mjs');
    await initClient(spec.metadataDir, spec.sourceRoot);
    writeFileSync(spec.out, JSON.stringify({ status: 'initialised' }));
    return;
  }

  if (spec.mode === 'after-init-crash') {
    const {
      initClient,
      refreshClient,
      verifyTrustedStateOffline,
    } = await import('../../spike/tuf-offline-metadata/client/client-core.mjs');
    let crashed = null;
    try {
      crashed = await snapshotDirectory(spec.metadataDir);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error; // killed before the directory existed
    }
    // A second init must either complete the bootstrap or refuse an existing root.
    const reinit = await outcome(initClient(spec.metadataDir, spec.sourceRoot).then(() => 'initialised'));
    const refresh = await outcome(refreshClient({
      metadataDir: spec.metadataDir,
      metadataUrl: 'https://repo.test/metadata/',
      now,
      fetchImpl: mirrorOf(spec.newBundle),
    }).then((result) => ({ status: result.status, staleTempsRemoved: result.staleTempsRemoved })));
    const recovered = await snapshotDirectory(spec.metadataDir);
    const offline = await outcome(verifyTrustedStateOffline(spec.metadataDir, { now })
      .then((result) => result.sha256));
    writeFileSync(spec.out, JSON.stringify({ crashed, reinit, refresh, recovered, offline }));
    return;
  }

  if (spec.mode === 'after-crash') {
    const {
      refreshClient,
      verifyTrustedStateOffline,
    } = await import('../../spike/tuf-offline-metadata/client/client-core.mjs');
    const refresh = (metadataDir, bundle) => outcome(refreshClient({
      metadataDir,
      metadataUrl: 'https://repo.test/metadata/',
      now,
      fetchImpl: mirrorOf(bundle),
    }).then((result) => result.status));

    // 1. Start-up read of the state exactly as the killed process left it.
    const crashed = await snapshotDirectory(spec.metadataDir);
    const offline = await outcome(verifyTrustedStateOffline(spec.metadataDir, { now })
      .then((result) => result.sha256));

    // 2. An attacker (or a stale mirror) replays the old bundle: on a copy, so the
    //    recovery below starts from the crashed state, not from the replay's.
    await cp(spec.metadataDir, spec.replayDir, { recursive: true });
    const replay = await refresh(spec.replayDir, spec.oldBundle);

    // 3. Recovery with the new bundle, then once more: healed means no-update.
    const recovery = await refresh(spec.metadataDir, spec.newBundle);
    const recovered = await snapshotDirectory(spec.metadataDir);
    const recoveredOffline = await outcome(verifyTrustedStateOffline(spec.metadataDir, { now })
      .then((result) => result.sha256));
    const second = await refresh(spec.metadataDir, spec.newBundle);

    writeFileSync(spec.out, JSON.stringify({
      crashed,
      offline,
      replay,
      recovery,
      recovered,
      recoveredOffline,
      second,
    }));
    return;
  }

  throw new Error(`unknown mode ${spec.mode}`);
}

await main();
