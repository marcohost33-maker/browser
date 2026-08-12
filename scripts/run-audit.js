#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { npmInvocation } from './npm-invocation.js';

const [command, args] = npmInvocation([
  'audit',
  '--json',
  '--audit-level=high',
  '--ignore-scripts',
]);

const result = spawnSync(command, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.error) {
  throw result.error;
}

const stdout = result.stdout?.trim();
if (!stdout) {
  process.stderr.write(`npm audit produced no JSON output.\n${result.stderr ?? ''}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(stdout);
} catch (error) {
  process.stderr.write(`npm audit returned invalid JSON: ${error.message}\n`);
  process.stderr.write(`${stdout}\n${result.stderr ?? ''}`);
  process.exit(1);
}

writeFileSync('npm-audit.json', `${JSON.stringify(report, null, 2)}\n`);

const vulnerabilities = report.metadata?.vulnerabilities;
if (!vulnerabilities || typeof vulnerabilities !== 'object') {
  process.stderr.write('npm audit JSON is missing metadata.vulnerabilities.\n');
  process.exit(1);
}

const summary = ['info', 'low', 'moderate', 'high', 'critical', 'total']
  .map((severity) => `${severity}=${vulnerabilities[severity] ?? 'missing'}`)
  .join(', ');
process.stdout.write(`npm audit snapshot: ${summary}.\n`);

if (result.status !== 0) {
  process.stderr.write(`npm audit failed the high-severity gate.\n${result.stderr ?? ''}`);
  process.exit(result.status ?? 1);
}
