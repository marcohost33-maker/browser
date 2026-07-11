import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { loadBaseline } from '../../src/security/csp.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'src', 'security', 'serialize-cli.js');
const ORIGIN = 'https://mcp.example.com';
let tempDir;
let baselinePath;

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CSP_APPROVED_ORIGINS;
  delete env.CSP_APPROVED_ENDPOINTS;
  return { ...env, ...extra };
}

function run(args = [], env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: cleanEnv(env),
    encoding: 'utf8',
  });
}

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'app01-cli-'));
  baselinePath = join(tempDir, 'baseline.json');
  const baseline = structuredClone(loadBaseline());
  baseline.directives['connect-src'] = ["'self'", ORIGIN];
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('CSP_APPROVED_ORIGINS accepts a matching HTTPS origin', () => {
  const result = run(['--check', '--baseline', baselinePath], {
    CSP_APPROVED_ORIGINS: ORIGIN,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /baseline OK/);
  assert.equal(result.stderr, '');
});

test('legacy CSP_APPROVED_ENDPOINTS works only as a warned compatibility alias', () => {
  const result = run(['--check', '--baseline', baselinePath], {
    CSP_APPROVED_ENDPOINTS: ORIGIN,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /deprecated/);
  assert.match(result.stderr, /origins, not endpoint URLs/);
});

test('setting current and legacy origin variables together is a usage error', () => {
  const result = run(['--check', '--baseline', baselinePath], {
    CSP_APPROVED_ORIGINS: ORIGIN,
    CSP_APPROVED_ENDPOINTS: ORIGIN,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /both cannot be used together/);
});

test('a full MCP endpoint URL is rejected where a CSP origin is required', () => {
  const result = run(['--check'], {
    CSP_APPROVED_ORIGINS: 'https://mcp.example.com/mcp',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an exact canonical origin/);
});

test('remote plain HTTP origin is rejected by the CLI gate', () => {
  const result = run(['--check'], {
    CSP_APPROVED_ORIGINS: 'http://mcp.example.com',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use HTTPS/);
});

test('--baseline without a path exits with usage status 2', () => {
  const result = run(['--baseline']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires a path/);
});

test('unknown CLI argument exits with usage status 2', () => {
  const result = run(['--unknown']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument/);
});
