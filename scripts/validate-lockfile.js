#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const lockfile = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const errors = [];
const root = lockfile.packages?.[''];

if (lockfile.lockfileVersion !== 3) {
  errors.push(`package-lock.json must use lockfileVersion 3, got ${lockfile.lockfileVersion}`);
}
if (!root) {
  errors.push('package-lock.json is missing the root package entry');
} else {
  const expectedDev = packageJson.devDependencies ?? {};
  const lockedDev = root.devDependencies ?? {};
  if (JSON.stringify(lockedDev) !== JSON.stringify(expectedDev)) {
    errors.push('root devDependencies do not exactly match package.json');
  }
  if (JSON.stringify(root.engines ?? {}) !== JSON.stringify(packageJson.engines ?? {})) {
    errors.push('root engines do not exactly match package.json');
  }
}

for (const [path, metadata] of Object.entries(lockfile.packages ?? {})) {
  if (!path) continue;
  if (metadata.resolved !== undefined) {
    errors.push(`${path} contains a registry-specific resolved URL`);
  }
  if (metadata.link !== true && typeof metadata.integrity !== 'string') {
    errors.push(`${path} is missing an integrity digest`);
  }
  if (metadata.hasInstallScript === true) {
    errors.push(`${path} declares an install lifecycle script`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`Lockfile verification failed:\n${errors.map((error) => `  - ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  `Lockfile OK: ${Object.keys(lockfile.packages).length - 1} integrity-pinned packages, no registry URLs or install scripts.\n`,
);
