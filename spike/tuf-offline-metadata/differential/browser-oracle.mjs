#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

import {
  parseTufMetadataBytes,
  verifyTopLevelMetadataBytes,
} from '../strict-json.js';

const [corpusPath, outputPath] = process.argv.slice(2);
if (!corpusPath || !outputPath) {
  throw new Error('usage: node browser-oracle.mjs <corpus.json> <result.json>');
}

function decode(value) {
  return Buffer.from(value, 'base64');
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
const results = [];

for (const item of corpus.cases) {
  try {
    const trustedRootBytes = decode(item.trusted_root_b64);
    const trustedRoot = parseTufMetadataBytes(
      trustedRootBytes,
      undefined,
      'trusted-root',
    );
    const trustedState = {
      root: trustedRoot,
      versions: item.trusted_versions ?? {
        timestamp: 0,
        snapshot: 0,
        targets: 0,
      },
      snapshotMeta: {},
    };

    const result = verifyTopLevelMetadataBytes({
      trustedState,
      bundle: {
        roots: item.roots_b64.map(decode),
        timestamp: decode(item.timestamp_b64),
        snapshot: decode(item.snapshot_b64),
        targets: decode(item.targets_b64),
      },
      now: new Date(item.now),
    });

    results.push({
      name: item.name,
      decision: 'accept',
      status: result.status,
      error: null,
    });
  } catch (error) {
    results.push({
      name: item.name,
      decision: 'reject',
      status: null,
      error: {
        name: error?.name ?? 'Error',
        code: error?.code ?? null,
        message: String(error?.message ?? error),
      },
    });
  }
}

writeFileSync(outputPath, `${JSON.stringify({
  oracle: 'browser-tuf-spike',
  results,
}, null, 2)}\n`);
