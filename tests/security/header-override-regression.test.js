// Regression tests for additional-header override and trust-direction bypasses.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';

import {
  loadBaseline,
  validateBaseline,
  applySecurityHeaders,
  serializeCsp,
  CspValidationError,
} from '../../src/security/csp.js';
import {
  buildHardenedHeaderMap,
  validateHardenedBaseline,
} from '../../src/security/header-values.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clone = globalThis.structuredClone ?? ((value) => JSON.parse(JSON.stringify(value)));
const REAL = loadBaseline();
const CLEAN_CSP = serializeCsp(REAL.directives);
const OVERRIDE_EVIL = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'aegis-poc-csp-override.json'), 'utf8'),
);

test('CSP override fixture is rejected and cannot build a hardened map', () => {
  const errors = validateHardenedBaseline(OVERRIDE_EVIL);
  assert.ok(
    errors.some((error) => /Content-Security-Policy/i.test(error) && /forbidden/.test(error)),
    errors.join(' | '),
  );
  assert.throws(() => buildHardenedHeaderMap(OVERRIDE_EVIL), CspValidationError);
});

for (const key of [
  'Content-Security-Policy',
  'content-security-policy',
  'CONTENT-security-Policy',
  'Content-Security-Policy-Report-Only',
  'content-security-policy-report-only',
]) {
  test(`additional_headers ${key} is rejected`, () => {
    const baseline = clone(REAL);
    baseline.additional_headers[key] = 'connect-src *';
    assert.ok(validateHardenedBaseline(baseline).length >= 1);
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  });
}

for (const key of ['Set-Cookie', 'X-Custom-Exfil', 'Server']) {
  test(`unexpected response header ${key} is rejected`, () => {
    const baseline = clone(REAL);
    baseline.additional_headers[key] = 'anything';
    assert.ok(
      validateHardenedBaseline(baseline).some((error) => /not permitted/.test(error)),
    );
  });
}

test('Access-Control-Allow-Origin is forbidden in the APP-01 response profile', () => {
  const baseline = clone(REAL);
  baseline.additional_headers['Access-Control-Allow-Origin'] = 'https://mcp.example.com';

  // The low-level legacy structural validator can recognize ACAO, but the only
  // supported CI/serving gate rejects it. Outbound MCP targets and inbound app
  // CORS permissions are opposite trust directions.
  assert.deepEqual(
    validateBaseline(baseline, { approvedEndpoints: ['https://mcp.example.com'] }),
    [],
  );
  assert.ok(
    validateHardenedBaseline(baseline, {
      approvedEndpoints: ['https://mcp.example.com'],
    }).some((error) => /not permitted in the M1 app-response profile/.test(error)),
  );
  assert.throws(
    () =>
      buildHardenedHeaderMap(baseline, {
        approvedEndpoints: ['https://mcp.example.com'],
      }),
    CspValidationError,
  );
});

test('clean committed baseline passes the complete hardened policy', () => {
  assert.deepEqual(validateHardenedBaseline(REAL), []);
});

let server;
let baseUrl;

before(async () => {
  server = createServer((req, res) => {
    let map;
    let status = 200;
    try {
      map = buildHardenedHeaderMap(OVERRIDE_EVIL);
    } catch {
      map = buildHardenedHeaderMap(REAL);
      status = 503;
    }
    applySecurityHeaders(res, map);
    res.statusCode = status;
    res.end('x');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(async () => {
  await new Promise((resolvePromise) => server.close(resolvePromise));
});

test('wire: injected CSP does not reach the response', async () => {
  const response = await fetch(baseUrl);
  const served = response.headers.get('content-security-policy');
  assert.equal(response.status, 503);
  assert.equal(served, CLEAN_CSP);
  assert.doesNotMatch(served, /connect-src[^;]*\*/);
});

test('wire: exactly one CSP header value is served', async () => {
  const response = await fetch(baseUrl);
  const served = response.headers.get('content-security-policy');
  assert.doesNotMatch(served, /,/);
});
