#!/usr/bin/env node
// Records what the running platform actually offers the activation store, so that a
// CI log on Windows or macOS is evidence rather than an assumption:
//
//   node spike/activation-store/harness/platform-probe.mjs
//
// Every probe runs against a fresh temporary directory through the same adapter the
// store uses. The output is one JSON object; nothing is asserted here (the tests do
// that), the point is the record.

import { constants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeIo } from '../node-io.js';

async function probe() {
  const io = createNodeIo();
  const directory = await mkdtemp(join(tmpdir(), 'activation-probe-'));
  const out = {
    platform: platform(),
    release: release(),
    arch: arch(),
    node: process.version,
    hasONoFollow: typeof constants.O_NOFOLLOW === 'number',
    currentUserIdKnown: typeof io.currentUserId === 'number',
  };
  try {
    const file = join(directory, 'file');
    const handle = await io.createExclusive(file, 0o600);
    await handle.write(Buffer.from('probe'));
    await handle.sync();
    await handle.close();
    out.exclusiveCreateRefusesExisting = await io.createExclusive(file, 0o600).then(() => false, (error) => error.code === 'EEXIST');
    out.hardLink = await io.link(file, join(directory, 'link'));
    out.hardLinkRefusesExisting = !(await io.link(file, join(directory, 'link')));
    out.syncFile = await io.syncFile(file);
    out.syncDir = await io.syncDir(directory);
    const immutable = join(directory, 'immutable');
    const object = await io.createExclusive(immutable, 0o444);
    await object.write(Buffer.from('object'));
    await object.close();
    await io.rename(immutable, join(directory, 'renamed'));
    out.renameOfImmutableFile = true;
    await io.unlink(join(directory, 'renamed'));
    out.unlinkOfImmutableFile = true;
    out.digestFile = (await io.digestFile(file, 16)).digest.slice(0, 16);
  } catch (error) {
    out.error = { code: error?.code, message: error?.message };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return out;
}

process.stdout.write(`${JSON.stringify(await probe(), null, 2)}\n`);
