import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SRC = join(ROOT, 'src');

function filesBelow(directory) {
  const result = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...filesBelow(path));
    else if (path.endsWith('.js')) result.push(path);
  }
  return result;
}

test('application/CLI source cannot import the raw buildHeaderMap primitive', () => {
  const allowed = new Set([
    'src/security/csp.js',
    'src/security/header-values.js',
  ]);
  const violations = [];

  for (const path of filesBelow(SRC)) {
    const repoPath = relative(ROOT, path).replaceAll('\\', '/');
    if (allowed.has(repoPath)) continue;
    const source = readFileSync(path, 'utf8');
    if (/\bbuildHeaderMap\b/.test(source)) violations.push(repoPath);
  }

  assert.deepEqual(
    violations,
    [],
    `source must use buildHardenedHeaderMap instead of raw buildHeaderMap: ${violations.join(', ')}`,
  );
});

test('CLI uses the complete hardened policy entry point', () => {
  const source = readFileSync(join(SRC, 'security', 'serialize-cli.js'), 'utf8');
  assert.match(source, /\bvalidateHardenedBaseline\b/);
  assert.match(source, /\bbuildHardenedHeaderMap\b/);
  assert.doesNotMatch(source, /\bvalidateBaseline\b/);
  assert.doesNotMatch(source, /\bbuildHeaderMap\b/);
});

test('served-header integration test uses the hardened map builder', () => {
  const source = readFileSync(
    join(ROOT, 'tests', 'security', 'headers-served.test.js'),
    'utf8',
  );
  assert.match(source, /\bbuildHardenedHeaderMap\b/);
  assert.doesNotMatch(source, /\bbuildHeaderMap\b/);
});
