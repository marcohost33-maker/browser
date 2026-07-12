#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const expectedNode = packageJson.engines?.node;
const expectedNpm = packageJson.engines?.npm;
const packageManager = packageJson.packageManager;
const actualNode = process.version.replace(/^v/, '');
const actualNpm = execFileSync('npm', ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const errors = [];

if (!/^\d+\.\d+\.\d+$/.test(expectedNode ?? '')) {
  errors.push(`package.json engines.node must be an exact version, got ${JSON.stringify(expectedNode)}`);
}
if (!/^\d+\.\d+\.\d+$/.test(expectedNpm ?? '')) {
  errors.push(`package.json engines.npm must be an exact version, got ${JSON.stringify(expectedNpm)}`);
}
if (packageManager !== `npm@${expectedNpm}`) {
  errors.push(
    `packageManager must equal npm@${expectedNpm}, got ${JSON.stringify(packageManager)}`,
  );
}
if (actualNode !== expectedNode) {
  errors.push(`Node version mismatch: expected ${expectedNode}, got ${actualNode}`);
}
if (actualNpm !== expectedNpm) {
  errors.push(`npm version mismatch: expected ${expectedNpm}, got ${actualNpm}`);
}

if (errors.length > 0) {
  process.stderr.write(`Toolchain verification failed:\n${errors.map((error) => `  - ${error}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Toolchain OK: Node ${actualNode}, npm ${actualNpm}.\n`);
