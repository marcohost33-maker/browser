#!/usr/bin/env node

import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  downloadTopLevelTargets,
  refreshTopLevel,
} from '../spike/tuf-conformance/top-level-client.js';

function parseArgs(argv) {
  const options = {
    targetNames: [],
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--metadata-dir') options.metadataDir = argv[++index];
    else if (token === '--metadata-url') options.metadataUrl = argv[++index];
    else if (token === '--target-name') options.targetNames.push(argv[++index]);
    else if (token === '--target-dir') options.targetDir = argv[++index];
    else if (token === '--target-base-url') options.targetBaseUrl = argv[++index];
    else if (token === '-v' || token === '--verbose') options.verbose = true;
    else positional.push(token);
  }

  options.command = positional[0];
  options.commandArgs = positional.slice(1);
  return options;
}

function requireValue(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

async function init(options) {
  const metadataDir = requireValue(options.metadataDir, '--metadata-dir');
  const trustedRoot = requireValue(options.commandArgs[0], 'trusted root path');
  await mkdir(metadataDir, { recursive: true });
  await copyFile(trustedRoot, path.join(metadataDir, 'root.json'));
}

async function refresh(options) {
  await refreshTopLevel({
    metadataDir: requireValue(options.metadataDir, '--metadata-dir'),
    metadataUrl: requireValue(options.metadataUrl, '--metadata-url'),
  });
}

async function download(options) {
  if (options.targetNames.length === 0) throw new Error('--target-name is required');
  await downloadTopLevelTargets({
    metadataDir: requireValue(options.metadataDir, '--metadata-dir'),
    metadataUrl: requireValue(options.metadataUrl, '--metadata-url'),
    targetBaseUrl: requireValue(options.targetBaseUrl, '--target-base-url'),
    targetDir: requireValue(options.targetDir, '--target-dir'),
    targetNames: options.targetNames,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'init') await init(options);
  else if (options.command === 'refresh') await refresh(options);
  else if (options.command === 'download') await download(options);
  else throw new Error('expected command: init, refresh or download');
}

try {
  await main();
  process.exitCode = 0;
} catch (error) {
  const code = error?.code ? ` [${error.code}]` : '';
  console.error(`tuf-conformance-client${code}: ${error?.message ?? error}`);
  process.exitCode = 1;
}
