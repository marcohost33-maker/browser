import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SRC = join(ROOT, 'src');

// Match every executable source extension, not only .js, so a future
// TypeScript bootstrap cannot import the raw primitives past this gate.
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];

function filesBelow(directory) {
  const result = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...filesBelow(path));
    else if (SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) result.push(path);
  }
  return result;
}

const RAW_PRIMITIVE_RULES = [
  {
    symbol: 'buildHeaderMap',
    allowed: new Set(['src/security/csp.js', 'src/security/header-values.js']),
  },
  {
    symbol: 'applySecurityHeaders',
    allowed: new Set(['src/security/csp.js', 'src/security/header-values.js']),
  },
  {
    symbol: 'serializeCsp',
    allowed: new Set(['src/security/csp.js', 'src/security/serialize-cli.js']),
  },
  {
    symbol: 'validateBaseline',
    allowed: new Set(['src/security/csp.js', 'src/security/header-values.js']),
  },
];

for (const rule of RAW_PRIMITIVE_RULES) {
  test(`application source cannot bypass hardened entry point with ${rule.symbol}`, () => {
    const violations = [];
    const pattern = new RegExp(`\\b${rule.symbol}\\b`);

    for (const path of filesBelow(SRC)) {
      const repoPath = relative(ROOT, path).replaceAll('\\', '/');
      if (rule.allowed.has(repoPath)) continue;
      const source = readFileSync(path, 'utf8');
      if (pattern.test(source)) violations.push(repoPath);
    }

    assert.deepEqual(
      violations,
      [],
      `source must use the hardened entry points instead of ${rule.symbol}: ${violations.join(', ')}`,
    );
  });
}

test('CLI uses the complete hardened policy entry point', () => {
  const source = readFileSync(join(SRC, 'security', 'serialize-cli.js'), 'utf8');
  assert.match(source, /\bvalidateHardenedBaseline\b/);
  assert.match(source, /\bbuildHardenedHeaderMap\b/);
  assert.doesNotMatch(source, /\bvalidateBaseline\b/);
  assert.doesNotMatch(source, /\bbuildHeaderMap\b/);
  assert.doesNotMatch(source, /\bapplySecurityHeaders\b/);
});

test('served-header integration test uses hardened apply and map entry points', () => {
  const source = readFileSync(
    join(ROOT, 'tests', 'security', 'headers-served.test.js'),
    'utf8',
  );
  assert.match(source, /\bbuildHardenedHeaderMap\b/);
  assert.match(source, /\bapplyHardenedSecurityHeaders\b/);
  assert.doesNotMatch(source, /\bbuildHeaderMap\b/);
  assert.doesNotMatch(source, /\bapplySecurityHeaders\b/);
});
