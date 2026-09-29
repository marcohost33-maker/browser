// Litmus tests for the crash-durability model. The crash matrix is only as credible
// as the model it enumerates, so each persistence rule it relies on is pinned here.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ModelFs, mulberry32 } from '../../spike/activation-store/harness/model-fs.js';

async function write(io, path, text, { sync = true } = {}) {
  const handle = await io.createExclusive(path, 0o600);
  await handle.write(Buffer.from(text, 'utf8'));
  if (sync) await handle.sync();
  await handle.close();
}

async function read(machine, path) {
  const bytes = await machine.io().readFile(path, 1_000);
  return bytes === null ? null : bytes.toString('utf8');
}

function fresh({ directorySync = true } = {}) {
  const machine = new ModelFs({ directorySync });
  return { machine, io: machine.io() };
}

test('a process crash keeps every completed operation visible', async () => {
  const { machine, io } = fresh();
  await io.mkdir('/d');
  await write(io, '/d/a', 'alpha', { sync: false });
  const crashed = machine.processCrashState();
  assert.deepEqual(crashed.listing(), machine.listing());
  assert.equal(await read(crashed, '/d/a'), 'alpha');
});

test('posix-strict: unsynced contents are empty even when the name is durable', async () => {
  const { machine, io } = fresh();
  await io.mkdir('/d');
  await io.syncDir('/');
  await write(io, '/d/a', 'alpha', { sync: false });
  await io.syncDir('/d');
  for (const state of machine.posixStrictStates({ samples: 4 })) {
    assert.equal(await read(state, '/d/a'), '', 'the entry survives but the data does not');
  }
});

test('posix-strict: a rename without a directory sync may or may not survive', async () => {
  const { machine, io } = fresh();
  await write(io, '/tmp-a', 'alpha');
  await io.rename('/tmp-a', '/a');
  const seen = new Set();
  for (const state of machine.posixStrictStates({ samples: 8 })) seen.add(await read(state, '/a'));
  assert.deepEqual([...seen].sort(), ['alpha', null].sort());
});

test('posix-strict: a directory sync makes its earlier entry changes mandatory', async () => {
  const { machine, io } = fresh();
  await write(io, '/a', 'alpha');
  await io.syncDir('/');
  await write(io, '/b', 'beta');
  for (const state of machine.posixStrictStates({ samples: 8 })) {
    assert.equal(await read(state, '/a'), 'alpha');
  }
});

test('posix-strict: the two sides of a cross-directory rename persist independently', async () => {
  const { machine, io } = fresh();
  await io.mkdir('/from');
  await io.mkdir('/to');
  await write(io, '/from/x', 'x');
  await io.syncDir('/');
  await io.syncDir('/from');
  await io.syncDir('/to');
  await io.rename('/from/x', '/to/x');
  const combinations = new Set();
  for (const state of machine.posixStrictStates({ samples: 16 })) {
    combinations.add(`${await read(state, '/from/x') !== null}:${await read(state, '/to/x') !== null}`);
  }
  assert.deepEqual([...combinations].sort(), ['false:false', 'false:true', 'true:false', 'true:true']);
});

test('ordered-prefix: a later metadata change never survives without an earlier one', async () => {
  const { machine, io } = fresh();
  await write(io, '/a', 'alpha');
  await write(io, '/b', 'beta');
  await write(io, '/c', 'gamma');
  const observed = [];
  for (const state of machine.orderedPrefixStates()) {
    observed.push([await read(state, '/a'), await read(state, '/b'), await read(state, '/c')].map((value) => value !== null));
  }
  assert.deepEqual(observed, [
    [false, false, false],
    [true, false, false],
    [true, true, false],
    [true, true, true],
  ]);
});

test('ordered-prefix: a directory sync is a global barrier', async () => {
  const { machine, io } = fresh();
  await io.mkdir('/d');
  await write(io, '/a', 'alpha');
  await io.syncDir('/d');
  await write(io, '/b', 'beta');
  for (const state of machine.orderedPrefixStates()) {
    assert.equal(await read(state, '/a'), 'alpha');
  }
});

test('without directory sync the call reports false and no barrier exists', async () => {
  const { machine, io } = fresh({ directorySync: false });
  await write(io, '/a', 'alpha');
  assert.equal(await io.syncDir('/'), false);
  const survivors = [];
  for (const state of machine.orderedPrefixStates()) survivors.push(await read(state, '/a'));
  assert.deepEqual(survivors, [null, 'alpha']);
});

test('with fileSyncBarrier a file sync is a global barrier, otherwise it is not', async () => {
  for (const fileSyncBarrier of [true, false]) {
    const machine = new ModelFs({ directorySync: false, fileSyncBarrier });
    const io = machine.io();
    await write(io, '/tmp-a', 'alpha');
    await io.rename('/tmp-a', '/a');
    assert.equal(await io.syncFile('/a'), true);
    await write(io, '/b', 'beta', { sync: false });
    const survivors = new Set();
    for (const state of machine.orderedPrefixStates()) survivors.add(await read(state, '/a'));
    assert.deepEqual([...survivors].sort(), fileSyncBarrier ? ['alpha'] : ['alpha', null].sort());
  }
});

test('syncFile follows the adapter contract: missing is false, links and directories fail', async () => {
  const { machine, io } = fresh();
  await io.mkdir('/d');
  await write(io, '/a', 'alpha');
  machine.symlinkNow('/a', '/link');
  assert.equal(await io.syncFile('/missing'), false);
  await assert.rejects(io.syncFile('/link'), (error) => error.code === 'ELOOP');
  await assert.rejects(io.syncFile('/d'), (error) => error.code === 'EISDIR');
  assert.deepEqual(await io.digestFile('/a', 10), { digest: (await import('node:crypto')).createHash('sha256').update('alpha').digest('hex'), size: 5 });
});

test('an unsynced unlink can be undone by a power loss', async () => {
  const { machine, io } = fresh();
  await write(io, '/a', 'alpha');
  await io.syncDir('/');
  machine.checkpoint();
  await io.unlink('/a');
  const seen = new Set();
  for (const state of machine.posixStrictStates({ samples: 4 })) seen.add(await read(state, '/a'));
  assert.deepEqual([...seen].sort(), ['alpha', null].sort());
});

test('the model io follows the adapter contract for exclusivity, links and bounds', async () => {
  const { machine, io } = fresh();
  await write(io, '/a', 'alpha');
  machine.symlinkNow('/a', '/link');
  await assert.rejects(io.createExclusive('/a', 0o600), (error) => error.code === 'EEXIST');
  await assert.rejects(io.createExclusive('/link', 0o600), (error) => error.code === 'EEXIST');
  await assert.rejects(io.readFile('/link', 100), (error) => error.code === 'ELOOP');
  await assert.rejects(io.readFile('/a', 2), (error) => error.code === 'EFBIG');
  assert.equal(await io.readFile('/missing', 2), null);
  assert.equal(await io.link('/a', '/link'), false);
  assert.equal(await io.link('/a', '/b'), true);
  assert.equal(await read(machine, '/b'), 'alpha');
  assert.equal(await io.mkdir('/a'), false);
  await assert.rejects(io.mkdir('/missing/child'), (error) => error.code === 'ENOENT');
  await assert.rejects(io.unlink('/missing'), (error) => error.code === 'ENOENT');
});

test('state enumeration is deterministic for a fixed seed', async () => {
  const build = async () => {
    const { machine, io } = fresh();
    for (const name of ['a', 'b', 'c']) {
      await io.mkdir(`/${name}`);
      await write(io, `/${name}/f`, name);
    }
    const prints = [];
    for (const state of machine.posixStrictStates({ samples: 6, seed: 7 })) prints.push(state.fingerprint());
    return prints;
  };
  assert.deepEqual(await build(), await build());
  const first = mulberry32(42);
  const second = mulberry32(42);
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
});
