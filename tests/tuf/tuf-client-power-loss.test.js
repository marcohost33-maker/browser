// Power-loss states of a refresh (BR64-04, what a SIGKILL cannot show).
//
// A process kill keeps the page cache, so a missing or misplaced fsync stays
// invisible to tuf-client-process-kill.test.js. Here the exact operations of one
// uninterrupted refresh are recorded (process-kill-worker.mjs, `opsLog`) and
// power-loss-model.mjs constructs every on-disk state a power cut after each
// operation may leave, under a strict POSIX persistence model (data durable only
// after fsync of the file, directory operations atomic but durable only after
// fsync of the directory, any subset of pending ones may survive). Each distinct
// state is laid down on disk and checked by a fresh process against K1-K5, and the
// states after the last operation against
//   K6 once the refresh has returned, a power cut leaves exactly the new state.
//
// Model limits (THREAT-MODEL.md): no torn writes within one write call, no lying
// device caches, only the metadata directory's own entries. This replaces the
// LazyFS run that could not be executed in this environment (external code).
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sha256 } from '../../spike/tuf-offline-metadata/tuf-offline.js';
import {
  digests,
  encodeBundle,
  materialize,
  MATRIX_SKIP,
  observeAndCheck,
  prepareTemplate,
  ROLES,
  scenarios,
  traceRefresh,
  writeReport,
} from './crash-matrix-support.mjs';
import { powerLossStates } from './power-loss-model.mjs';

async function initialFiles(dir) {
  const files = new Map();
  for (const name of (await readdir(dir)).sort()) files.set(name, await readFile(join(dir, name)));
  return files;
}

async function powerLossMatrix(fx, scenario) {
  const base = await mkdtemp(join(tmpdir(), `browser-tuf-power-${scenario.name}-`));
  const { template, oldFiles } = await prepareTemplate(fx, base, scenario);
  const ctx = {
    base,
    oldDigests: digests(oldFiles),
    newDigests: digests({ ...scenario.next, root: scenario.next.roots.at(-1) ?? oldFiles.root }),
    oldBundle: encodeBundle(scenario.setup),
    newBundle: encodeBundle(scenario.next),
  };
  const trace = await traceRefresh(base, template, 'power', ctx.newBundle, { withOps: true });
  assert.equal(trace.status, 'metadata-verified', `${scenario.name}: uninterrupted control`);
  assert.ok(trace.ops.length > 0, `${scenario.name}: no operation recorded`);

  const { states, finalStates, opCount } = powerLossStates(await initialFiles(template), trace.ops);

  // K6: the refresh returned success, so a power cut now must not lose any of it.
  for (const state of finalStates) {
    const roles = Object.fromEntries(ROLES.map((role) => [role, state.files.has(`${role}.json`)
      ? sha256(state.files.get(`${role}.json`)) : null]));
    assert.deepEqual(roles, ctx.newDigests, `${scenario.name}: a power cut after the refresh returned lost committed state`);
    assert.equal(state.files.has('rollback-reset.json'), false, `${scenario.name}: reset marker can reappear after the refresh returned`);
  }

  const rows = [];
  for (const [index, state] of states.entries()) {
    const tag = `p${index}`;
    const metadataDir = join(base, tag);
    await materialize(metadataDir, state.files);
    const row = await observeAndCheck({
      ...ctx, metadataDir, tag,
      context: `${scenario.name} power loss after op ${state.prefix}/${opCount} `
        + `(${state.prefix === 0 ? 'start' : JSON.stringify({ ...trace.ops[state.prefix - 1], data: undefined })}), `
        + `state ${state.hash.slice(0, 12)}: ${[...state.files.keys()].join(', ')}`,
    });
    rows.push({ prefix: state.prefix, files: [...state.files.keys()], ...row });
  }
  await rm(base, { recursive: true, force: true });
  return { opCount, rows, finalStates: finalStates.length };
}

for (const index of [0, 1, 2]) {
  test(`every power-loss state of a refresh is old, new or refused, and a returned refresh is durable (scenario ${index + 1})`, {
    skip: MATRIX_SKIP,
    timeout: 300_000,
  }, async (t) => {
    const { fx, list } = await scenarios();
    const scenario = list[index];
    const { opCount, rows, finalStates } = await powerLossMatrix(fx, scenario);
    const count = (value) => rows.filter((row) => row.state === value).length;
    t.diagnostic(`${scenario.name}: ${opCount} operations, ${rows.length} distinct power-loss states `
      + `(old ${count('old')}, between ${count('between')}, new ${count('new')}), ${finalStates} after return`);
    await writeReport(`power-${scenario.name}`, { scenario: scenario.name, opCount, rows });
    assert.ok(count('old') > 0 && count('between') > 0 && count('new') > 0);
  });
}

// --- the model itself -------------------------------------------------------
// Self-test against the classic write-then-rename failure (the ext4 delayed
// allocation "zero-length file" class, ALICE): without fsync of the data before
// the rename, a power cut after a durable rename can leave an EMPTY file. The
// model must produce that state, and must not produce it once the data is synced.

const OLD = Buffer.from('old content');
const NEW = Buffer.from('new content');
const replaceOps = (withFileSync) => [
  { op: 'open-write', name: '.a.json.tmp-1-1', exclusive: true },
  { op: 'write', name: '.a.json.tmp-1-1', data: NEW.toString('base64') },
  ...(withFileSync ? [{ op: 'fsync', name: '.a.json.tmp-1-1' }] : []),
  { op: 'rename', from: '.a.json.tmp-1-1', to: 'a.json' },
  { op: 'fsync-dir', name: '.' },
];
const contentsOfA = (states) => new Set(states.map((state) => state.files.get('a.json')?.toString() ?? '<absent>'));

test('the power-loss model finds the empty file of a rename without fsync', () => {
  const unsafe = powerLossStates(new Map([['a.json', OLD]]), replaceOps(false));
  assert.ok(contentsOfA(unsafe.states).has(''), 'model must show the zero-length file');
  assert.ok(contentsOfA(unsafe.finalStates).has(''), 'even after the directory sync');

  const safe = powerLossStates(new Map([['a.json', OLD]]), replaceOps(true));
  assert.deepEqual([...contentsOfA(safe.states)].sort(), ['new content', 'old content']);
  assert.deepEqual([...contentsOfA(safe.finalStates)], ['new content']);
});

test('the power-loss model loses a rename that no directory sync made durable', () => {
  const ops = replaceOps(true).slice(0, -1); // no fsync-dir
  const { finalStates } = powerLossStates(new Map([['a.json', OLD]]), ops);
  assert.deepEqual([...contentsOfA(finalStates)].sort(), ['new content', 'old content']);
});

