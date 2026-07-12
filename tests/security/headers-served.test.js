// M1B integration test: security headers are served on a real HTTP response,
// produced from the committed baseline through the hardened response boundary.
// This is in-process evidence only; CDN/edge/browser verification remains open.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { loadBaseline } from '../../src/security/csp.js';
import {
  applyHardenedSecurityHeaders,
  buildHardenedHeaderMap,
} from '../../src/security/header-values.js';

let server;
let baseUrl;
const baseline = loadBaseline();
const headerMap = buildHardenedHeaderMap(baseline);

before(async () => {
  server = createServer((req, res) => {
    applyHardenedSecurityHeaders(res, baseline);
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

test('served response carries the CSP header equal to the hardened baseline', async () => {
  const res = await fetch(baseUrl);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get('content-security-policy'),
    headerMap['Content-Security-Policy'],
  );
});

test('served CSP pins connect-src to self without wildcard or scheme sources', async () => {
  const res = await fetch(baseUrl);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /(^|; )connect-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /connect-src[^;]*\*/);
  assert.doesNotMatch(csp, /connect-src[^;]*\bhttps:/);
});

for (const [name, value] of Object.entries(headerMap)) {
  test(`served response carries exact protected header ${name}`, async () => {
    const res = await fetch(baseUrl);
    assert.equal(res.headers.get(name.toLowerCase()), value);
  });
}

test('served response advertises Trusted Types enforcement', async () => {
  const res = await fetch(baseUrl);
  assert.match(
    res.headers.get('content-security-policy'),
    /require-trusted-types-for 'script'/,
  );
});

test('served Permissions-Policy equals the reviewed committed deny set', async () => {
  const res = await fetch(baseUrl);
  assert.equal(
    res.headers.get('permissions-policy'),
    baseline.additional_headers['Permissions-Policy'],
  );
});
