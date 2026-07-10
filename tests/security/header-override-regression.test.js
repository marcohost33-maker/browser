// M1B enforcement regression — Aegis re-audit P0 residual (2026-07-11).
//
// additional_headers could re-open the crown-jewel: buildHeaderMap copied every
// additional header verbatim and validation never restricted WHICH header
// names were allowed. An additional_headers `Content-Security-Policy` key (any
// case; Node case-folds so the later lowercase setHeader wins) overrode the
// generated CSP on the wire while `--check` still reported exit 0.
//
// Fix: additional_headers name allowlist; `content-security-policy` and
// `content-security-policy-report-only` forbidden case-insensitively; ACAO
// restricted to the approved-origin set; buildHeaderMap never lets an
// additional header overwrite an already-set (CSP) header. These tests BITE.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';

import {
  loadBaseline,
  validateBaseline,
  buildHeaderMap,
  applySecurityHeaders,
  serializeCsp,
  CspValidationError,
} from '../../src/security/csp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clone = globalThis.structuredClone ?? ((o) => JSON.parse(JSON.stringify(o)));
const REAL = loadBaseline();
const CLEAN_CSP = serializeCsp(REAL.directives);

const OVERRIDE_EVIL = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'aegis-poc-csp-override.json'), 'utf8'),
);

// --- (a) CSP override via additional_headers — upper + lower case -----------

test('Aegis PoC csp-override fixture is REJECTED (Content-Security-Policy key)', () => {
  const errors = validateBaseline(OVERRIDE_EVIL);
  assert.ok(
    errors.some((e) => /Content-Security-Policy/i.test(e) && /forbidden/.test(e)),
    `expected CSP-key rejection, got: ${errors.join(' | ')}`,
  );
  assert.throws(() => buildHeaderMap(OVERRIDE_EVIL), CspValidationError);
});

for (const key of ['Content-Security-Policy', 'content-security-policy', 'CONTENT-security-Policy']) {
  test(`vector: additional_headers "${key}" key -> reject`, () => {
    const m = clone(REAL);
    m.additional_headers[key] = 'connect-src *';
    assert.ok(validateBaseline(m).some((e) => /forbidden/.test(e)), key);
  });
}

// --- (b) Report-Only twin ---------------------------------------------------

for (const key of ['Content-Security-Policy-Report-Only', 'content-security-policy-report-only']) {
  test(`vector: additional_headers "${key}" key -> reject`, () => {
    const m = clone(REAL);
    m.additional_headers[key] = "default-src *; report-uri https://evil.example.com/r";
    assert.ok(validateBaseline(m).some((e) => /forbidden/.test(e)), key);
  });
}

// --- (c) non-allowlisted header name ---------------------------------------

for (const key of ['Set-Cookie', 'X-Custom-Exfil', 'Server']) {
  test(`vector: non-allowlisted header "${key}" -> reject`, () => {
    const m = clone(REAL);
    m.additional_headers[key] = 'anything';
    assert.ok(
      validateBaseline(m).some((e) => /not on the additional_headers allowlist/.test(e)),
      key,
    );
  });
}

// --- (d) Access-Control-Allow-Origin restricted to approved origins ---------

test('vector: ACAO * -> reject', () => {
  const m = clone(REAL);
  m.additional_headers['Access-Control-Allow-Origin'] = '*';
  assert.ok(validateBaseline(m).some((e) => /Access-Control-Allow-Origin/.test(e)));
});

test('vector: ACAO fixed foreign origin (not on allowlist) -> reject', () => {
  const m = clone(REAL);
  m.additional_headers['Access-Control-Allow-Origin'] = 'https://evil.example.com';
  assert.ok(
    validateBaseline(m).some((e) => /Access-Control-Allow-Origin/.test(e) && /approved/.test(e)),
  );
});

test('ACAO approved origin is accepted only with the curated allowlist', () => {
  const m = clone(REAL);
  m.additional_headers['Access-Control-Allow-Origin'] = 'https://mcp.example.com';
  assert.ok(validateBaseline(m).length >= 1); // no allowlist -> reject
  assert.deepEqual(
    validateBaseline(m, { approvedEndpoints: ['https://mcp.example.com'] }),
    [],
  );
});

// --- clean baseline stays clean (no false positive) -------------------------

test('clean committed baseline still passes (allowlist covers all 8 headers)', () => {
  assert.deepEqual(validateBaseline(REAL), []);
});

// --- WIRE proof: the override never reaches the wire (real HTTP server) -----
//
// Serves via the same pattern as headers-served.test.js. The handler tries to
// build the header map from the evil override baseline; enforcement makes it
// fail closed, and the response carries the directives-derived CSP — never the
// injected `connect-src *`.

let server;
let baseUrl;

before(async () => {
  server = createServer((req, res) => {
    let map;
    let status = 200;
    try {
      map = buildHeaderMap(OVERRIDE_EVIL); // rejected -> throws
    } catch {
      map = buildHeaderMap(REAL); // fail-closed: serve the safe baseline
      status = 503;
    }
    applySecurityHeaders(res, map);
    res.statusCode = status;
    res.end('x');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test('wire: injected additional_headers CSP does NOT reach the response', async () => {
  const res = await fetch(baseUrl);
  const served = res.headers.get('content-security-policy');
  assert.equal(res.status, 503, 'evil override must be rejected fail-closed');
  assert.notEqual(served, 'connect-src *', 'the injected CSP must never be served');
  assert.equal(served, CLEAN_CSP, 'served CSP must be the directives-derived policy');
  assert.match(served, /(^|; )connect-src 'self'(;|$)/);
});

test('wire: exactly one content-security-policy header value on the wire', async () => {
  const res = await fetch(baseUrl);
  // getSetCookie-style duplication check: Headers folds duplicates with ", ".
  const served = res.headers.get('content-security-policy');
  assert.doesNotMatch(served, /,/, 'no duplicate/second CSP header value');
});
