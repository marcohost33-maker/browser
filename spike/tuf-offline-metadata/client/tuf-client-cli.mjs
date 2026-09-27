#!/usr/bin/env node
import {
  downloadTargets,
  initClient,
  refreshClient,
  TufClientError,
} from './client-core.mjs';

function parseArgs(argv) {
  const options = {
    targetNames: [],
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const value = argv[index + 1];
    switch (arg) {
      case '--metadata-dir':
        options.metadataDir = value;
        index += 1;
        break;
      case '--metadata-url':
        options.metadataUrl = value;
        index += 1;
        break;
      case '--target-name':
        options.targetNames.push(value);
        index += 1;
        break;
      case '--target-dir':
        options.targetDir = value;
        index += 1;
        break;
      case '--target-base-url':
        options.targetBaseUrl = value;
        index += 1;
        break;
      default:
        throw new TufClientError('UNKNOWN_ARGUMENT', `unknown argument: ${arg}`);
    }
  }

  return { options, positional };
}

function required(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TufClientError('MISSING_ARGUMENT', `${label} is required`);
  }
  return value;
}

async function main(argv) {
  const { options, positional } = parseArgs(argv);
  const command = positional[0];
  const metadataDir = required(options.metadataDir, '--metadata-dir');

  if (command === 'init') {
    const trustedRoot = required(positional[1], 'trusted root path');
    await initClient(metadataDir, trustedRoot);
    return;
  }

  if (command === 'refresh') {
    await refreshClient({
      metadataDir,
      metadataUrl: required(options.metadataUrl, '--metadata-url'),
    });
    return;
  }

  if (command === 'download') {
    await downloadTargets({
      metadataDir,
      metadataUrl: required(options.metadataUrl, '--metadata-url'),
      targetBaseUrl: required(options.targetBaseUrl, '--target-base-url'),
      targetDir: required(options.targetDir, '--target-dir'),
      targetNames: options.targetNames,
    });
    return;
  }

  throw new TufClientError(
    'UNKNOWN_COMMAND',
    'expected init, refresh, or download',
  );
}

main(process.argv.slice(2)).catch((error) => {
  const code = error?.code ? ` [${error.code}]` : '';
  console.error(`tuf-client-cli${code}: ${error?.message ?? error}`);
  process.exitCode = 1;
});
