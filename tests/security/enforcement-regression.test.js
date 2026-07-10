// M1B enforcement regression tests — Aegis PoC vectors (2026-07-10).
//
// The first serializer validated only the connect-src array + partial
// script-src and serialized every other directive + additional_header RAW.
// Aegis' PoC therefore passed `--check` (exit 0) while serving
// `connect-src * data: https://evil` (via a `;`-injection in default-src),
// `form-action https://evil` (via img-src), and HSTS `max-age=0`.
//
// Each vector below MUST now yield >=1 violation (build fails / exit 1). These
// tests BITE: comment out the corresponding guard in csp.js and they go red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  loadBaseline,
  validateBaseline,
  buildHeaderMap,
  serializeCsp,
  validateConnectSrc,
  CspValidationError,
} from '../../src/security/csp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clone = globalThis.structuredClone ?? ((o) => JSON.parse(JSON.stringify(o)));
const REAL = loadBaseline();

// --- Aegis' full PoC baseline as a committed fixture (must be rejected) -----

test('Aegis PoC evil-baseline is REJECTED (default-src injection + HSTS downgrade)', () => {
  const evil = JSON.parse(
    readFileSync(resolve(__dirname, 'fixtures', 'aegis-poc-evil-baseline.json'), 'utf8'),
  );
  const errors = validateBaseline(evil);
  assert.ok(errors.length >= 1, 'evil baseline must produce violations');
  // the `;`-injection in default-src is caught as an illegal-char injection
  assert.ok(
    errors.some((e) => /default-src/.test(e) && /injection|illegal/.test(e)),
    `expected default-src injection violation, got: ${errors.join(' | ')}`,
  );
  // the img-src `;`-injection (form-action smuggling) is caught too
  assert.ok(errors.some((e) => /img-src/.test(e)));
  // HSTS downgrade to max-age=0 is caught
  assert.ok(errors.some((e) => /Strict-Transport-Security/.test(e) && /downgrade|floor/.test(e)));
  // and it can never be served
  assert.throws(() => buildHeaderMap(evil), CspValidationError);
});

// --- individual PoC vectors (mutate the real baseline) ----------------------

// 1 + 7. default-src `;`-injection = smuggled extra (duplicate) connect-src.
test('vector: default-src `;`-injection (smuggles connect-src * data: https://evil) -> reject', () => {
  const m = clone(REAL);
  m.directives['default-src'] = ["'none'; connect-src https://evil.example.com data: *"];
  const errors = validateBaseline(m);
  assert.ok(errors.some((e) => /default-src/.test(e) && /injection|illegal/.test(e)));
  // serializer itself refuses to emit it (defence in depth)
  assert.throws(() => serializeCsp(m.directives), CspValidationError);
});

// 2. additional_headers HSTS downgrade.
test('vector: HSTS max-age=0 downgrade -> reject', () => {
  const m = clone(REAL);
  m.additional_headers['Strict-Transport-Security'] = 'max-age=0';
  assert.ok(validateBaseline(m).some((e) => /Strict-Transport-Security/.test(e)));
});

test('vector: HSTS below 1-year floor -> reject', () => {
  const m = clone(REAL);
  m.additional_headers['Strict-Transport-Security'] = 'max-age=3600; includeSubDomains';
  assert.ok(validateBaseline(m).some((e) => /below floor/.test(e)));
});

// 3. img-src widening (GET-beacon exfil).
for (const bad of ['*', 'https:', 'http:', 'https://evil.example.com']) {
  test(`vector: img-src widening "${bad}" -> reject`, () => {
    const m = clone(REAL);
    m.directives['img-src'] = ["'self'", bad];
    assert.ok(validateBaseline(m).some((e) => /img-src/.test(e)), `img-src ${bad}`);
  });
}

test('img-src still accepts the baseline data: scheme (no false positive)', () => {
  assert.deepEqual(validateConnectSrc(["'self'"]), []); // sanity: real path clean
  const errors = validateBaseline(REAL);
  assert.deepEqual(errors, [], `clean baseline must pass: ${errors.join(' | ')}`);
});

// 4. form-action widening (form exfil).
for (const bad of ['*', 'https:', 'https://evil.example.com']) {
  test(`vector: form-action widening "${bad}" -> reject`, () => {
    const m = clone(REAL);
    m.directives['form-action'] = ["'self'", bad];
    assert.ok(validateBaseline(m).some((e) => /form-action/.test(e)), `form-action ${bad}`);
  });
}

// 5. base-uri widening (<base> hijack).
for (const bad of ['*', 'https://evil.example.com', 'http:']) {
  test(`vector: base-uri widening "${bad}" -> reject`, () => {
    const m = clone(REAL);
    m.directives['base-uri'] = [bad];
    assert.ok(validateBaseline(m).some((e) => /base-uri/.test(e)), `base-uri ${bad}`);
  });
}

// 6. script-src foreign host (previously PASSED: `script-src 'self' https://evil.com`).
for (const bad of ['https://evil.com', 'data:', 'blob:', "'unsafe-hashes'", "'strict-dynamic'"]) {
  test(`vector: script-src "${bad}" -> reject`, () => {
    const m = clone(REAL);
    m.directives['script-src'] = ["'self'", bad];
    assert.ok(validateBaseline(m).some((e) => /script-src/.test(e)), `script-src ${bad}`);
  });
}

test('script-src still accepts a valid nonce/hash (no false positive)', () => {
  const m = clone(REAL);
  m.directives['script-src'] = ["'self'", "'nonce-abc123XYZ'", "'sha256-AAAA+bbb/ccc='"];
  assert.deepEqual(
    validateBaseline(m),
    [],
    'valid nonce/hash must not be rejected',
  );
});

// --- additional_headers weakening + injection ------------------------------

test('vector: Access-Control-Allow-Origin: * -> reject', () => {
  const m = clone(REAL);
  m.additional_headers['Access-Control-Allow-Origin'] = '*';
  assert.ok(validateBaseline(m).some((e) => /Access-Control-Allow-Origin/.test(e)));
});

test('vector: header value with CRLF injection -> reject', () => {
  const m = clone(REAL);
  m.additional_headers['Referrer-Policy'] = 'no-referrer\r\nSet-Cookie: p=1';
  assert.ok(validateBaseline(m).some((e) => /control char|header-injection/.test(e)));
});

test('vector: weakened COOP/COEP/CORP -> reject', () => {
  for (const [h, v] of [
    ['Cross-Origin-Opener-Policy', 'unsafe-none'],
    ['Cross-Origin-Embedder-Policy', 'unsafe-none'],
    ['Cross-Origin-Resource-Policy', 'cross-origin'],
    ['X-Frame-Options', 'ALLOWALL'],
    ['X-Content-Type-Options', 'sniff'],
  ]) {
    const m = clone(REAL);
    m.additional_headers[h] = v;
    assert.ok(validateBaseline(m).some((e) => new RegExp(h).test(e)), `${h}: ${v}`);
  }
});

// --- unknown directive + non-string source ---------------------------------

test('vector: unknown directive name -> reject', () => {
  const m = clone(REAL);
  m.directives['totally-made-up-src'] = ["'self'"];
  assert.ok(validateBaseline(m).some((e) => /unknown directive/.test(e)));
});

test('Equalita wart: non-string connect-src element -> violation, not TypeError', () => {
  assert.doesNotThrow(() => validateConnectSrc(["'self'", null, 42]));
  const errors = validateConnectSrc(["'self'", null, 42]);
  assert.equal(errors.length, 2);
  assert.ok(errors.every((e) => /non-string source/.test(e)));
});
