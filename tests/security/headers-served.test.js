// M1B integration test: the security headers are ACTUALLY served on a real
// HTTP response, produced by the serializer from csp-baseline.json.
//
// This exercises the enforcement path end-to-end at the HTTP layer using
// Node's built-in http server + global fetch (Node >=18) — no test framework,
// no server framework, no runtime deps. It does NOT cover the dynamic
// per-endpoint connect-src injection / MCP-client runtime (browser#11, blocked
// on the MCP client runtime); that remains documented as runtime-blocked.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import {
  loadBaseline,
  applySecurityHeaders,
} from '../../src/security/csp.js';
import { buildHardenedHeaderMap } from '../../src/security/header-values.js';

let server;
let baseUrl;
const headerMap = buildHardenedHeaderMap(loadBaseline());

before(async () => {
  server = createServer((req, res) => {
    // This mirrors the intended serving path: every response carries the
    // baseline-derived security headers before the body is written.
    applySecurityHeaders(res, headerMap);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;
    res.end('<!doctype html><title>APP-01</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('served response carries the CSP header equal to the serialized baseline', async () => {
  const res = await fetch(baseUrl);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get('content-security-policy'),
    headerMap['Content-Security-Policy'],
  );
});

test('served CSP pins connect-src to self (no wildcard/scheme-source)', async () => {
  const res = await fetch(baseUrl);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /(^|; )connect-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /connect-src[^;]*\*/);
  assert.doesNotMatch(csp, /connect-src[^;]*\bhttps:/);
});

// Each of the non-CSP security headers must be present with its baseline value.
const EXPECTED_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

for (const [name, value] of Object.entries(EXPECTED_HEADERS)) {
  test(`served response carries ${name}: ${value}`, async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.headers.get(name), value);
  });
}

test('served response advertises Trusted-Types (require-trusted-types-for)', async () => {
  const res = await fetch(baseUrl);
  assert.match(
    res.headers.get('content-security-policy'),
    /require-trusted-types-for 'script'/,
  );
});

test('Permissions-Policy disables every M1 powerful-feature baseline entry', async () => {
  const res = await fetch(baseUrl);
  const pp = res.headers.get('permissions-policy');
  for (const feature of [
    'camera',
    'microphone',
    'geolocation',
    'payment',
    'usb',
    'interest-cohort',
  ]) {
    assert.match(pp, new RegExp(`(^|,\\s*)${feature}=\\(\\)($|,)`));
  }
});
