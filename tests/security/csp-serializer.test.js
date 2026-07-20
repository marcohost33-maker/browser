// M1B enforcement tests: serializer correctness + the connect-src negative
// test (the crown-jewel exfiltration control). Zero deps: Node's built-in
// test runner + node:assert (`node --test`).
//
// The negative test MUST BITE: a violating connect-src -> validation errors;
// the real committed baseline -> clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadBaseline,
  serializeCsp,
  validateBaseline,
  validateConnectSrc,
  buildHeaderMap,
  isExactOrigin,
  CspValidationError,
  DEFAULT_BASELINE_PATH,
} from '../../src/security/csp.js';

// Node >=17 has global structuredClone; fall back to JSON round-trip.
const clone = globalThis.structuredClone ?? ((o) => JSON.parse(JSON.stringify(o)));

const REAL = loadBaseline();
const FORBIDDEN = REAL.connect_src_policy.forbidden_tokens;

// --- serializer correctness ------------------------------------------------

test('serializeCsp emits the documented baseline CSP string', () => {
  const csp = serializeCsp(REAL.directives);
  // spot-check load-bearing directives exactly as documented.
  assert.match(csp, /(^|; )default-src 'none'(;|$)/);
  assert.match(csp, /(^|; )connect-src 'self'(;|$)/);
  assert.match(csp, /(^|; )script-src 'self'(;|$)/);
  assert.match(csp, /(^|; )frame-ancestors 'none'(;|$)/);
  assert.match(csp, /(^|; )require-trusted-types-for 'script'(;|$)/);
});

test('valueless directive is serialized as the name alone (no trailing space)', () => {
  const csp = serializeCsp(REAL.directives);
  assert.match(csp, /(^|; )upgrade-insecure-requests(;|$)/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests /);
});

test('serializeCsp rejects a non-array directive value', () => {
  assert.throws(
    () => serializeCsp({ 'connect-src': "'self'" }),
    CspValidationError,
  );
});

test('serializeCsp refuses an injected directive NAME (separator/control char)', () => {
  // Aegis PoC: a `;`/whitespace-carrying key would smuggle an extra directive
  // into the serialized string. The serializer must refuse to emit it.
  assert.throws(
    () =>
      serializeCsp({
        'script-src': ["'self'"],
        'x-evil connect-src *': ["'self'"],
      }),
    CspValidationError,
  );
});

test('serializeCsp refuses an unknown (non-whitelisted) directive NAME', () => {
  assert.throws(
    () => serializeCsp({ 'script-src': ["'self'"], 'totally-made-up-src': ["'self'"] }),
    CspValidationError,
  );
});

test('serializeCsp emits every known/whitelisted directive name unchanged', () => {
  const csp = serializeCsp({
    'default-src': ["'none'"],
    'script-src': ["'self'"],
    'upgrade-insecure-requests': [],
  });
  assert.equal(csp, "default-src 'none'; script-src 'self'; upgrade-insecure-requests");
});

// --- header map (single source of truth) -----------------------------------

test('buildHeaderMap emits CSP plus every additional header from the baseline', () => {
  const headers = buildHeaderMap(REAL);
  assert.ok(headers['Content-Security-Policy']);
  for (const name of Object.keys(REAL.additional_headers)) {
    assert.equal(headers[name], REAL.additional_headers[name], `${name} mismatch`);
  }
  // no duplicate CSP definition: the served CSP comes only from directives.
  assert.equal(
    headers['Content-Security-Policy'],
    serializeCsp(REAL.directives),
  );
});

test('the served header set includes HSTS/COOP/COEP/CORP/Trusted-Types', () => {
  const headers = buildHeaderMap(REAL);
  assert.ok(headers['Strict-Transport-Security'].includes('max-age='));
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.match(
    headers['Content-Security-Policy'],
    /require-trusted-types-for 'script'/,
  );
});

// --- isExactOrigin oracle --------------------------------------------------

test('isExactOrigin accepts exact origins, rejects wildcards/paths/scheme-only', () => {
  assert.equal(isExactOrigin('https://mcp.example.com'), true);
  assert.equal(isExactOrigin('https://mcp.example.com:8443'), true);
  assert.equal(isExactOrigin('https://mcp.example.com/'), false); // trailing path
  assert.equal(isExactOrigin('https://mcp.example.com/api'), false);
  assert.equal(isExactOrigin('https://*.example.com'), false); // wildcard host
  assert.equal(isExactOrigin('https:'), false); // scheme-only
  assert.equal(isExactOrigin('*'), false);
  assert.equal(isExactOrigin('data:'), false);
});

test('isExactOrigin rejects a trailing-dot FQDN host (canonicalization bypass)', () => {
  assert.equal(isExactOrigin('https://example.com.'), false);
  assert.equal(isExactOrigin('https://mcp.example.com.'), false);
  assert.equal(isExactOrigin('https://mcp.example.com.:8443'), false);
});

// --- THE crown-jewel connect-src negative test (must BITE) ------------------

// Each violating source, when placed in connect-src, must yield >=1 error.
const VIOLATING_CONNECT_SRC = [
  '*', // total wildcard
  'https:', // scheme-source (issue names this explicitly)
  'http:', // scheme-source (issue names this explicitly)
  'data:',
  'blob:',
  'ws:',
  "'unsafe-inline'",
  'https://*.evil.example', // wildcard host
  'https://attacker.example.com', // exact origin but NOT in approved set
  'https://mcp.example.com/exfil', // origin with path
];

for (const bad of VIOLATING_CONNECT_SRC) {
  test(`connect-src negative test BITES on "${bad}"`, () => {
    const mutated = clone(REAL);
    mutated.directives['connect-src'] = ["'self'", bad];
    const errors = validateBaseline(mutated); // no approved endpoints
    assert.ok(
      errors.length >= 1,
      `expected a violation for connect-src source "${bad}", got none`,
    );
    // and buildHeaderMap must refuse to serve it (fail-closed).
    assert.throws(() => buildHeaderMap(mutated), CspValidationError);
  });
}

test('clean baseline (self-only) passes with NO violations', () => {
  const errors = validateBaseline(REAL);
  assert.deepEqual(errors, [], `unexpected violations: ${errors.join(' | ')}`);
});

test('an approved exact origin is accepted only when in the allowlist', () => {
  const mutated = clone(REAL);
  mutated.directives['connect-src'] = ["'self'", 'https://mcp.example.com'];
  // without allowlist -> rejected
  assert.ok(validateBaseline(mutated).length >= 1);
  // with the curated allowlist -> clean
  assert.deepEqual(
    validateBaseline(mutated, { approvedEndpoints: ['https://mcp.example.com'] }),
    [],
  );
});

// --- silent-failure / edge inputs ------------------------------------------

test('empty connect-src is rejected (must pin at least self)', () => {
  const errors = validateConnectSrc([], { forbiddenTokens: FORBIDDEN });
  assert.ok(errors.length >= 1);
});

test('missing connect-src directive is rejected', () => {
  const mutated = clone(REAL);
  delete mutated.directives['connect-src'];
  const errors = validateBaseline(mutated);
  assert.ok(errors.some((e) => /connect-src/.test(e)));
});

test('missing default-src / script-src are rejected (required directives)', () => {
  const noDefault = clone(REAL);
  delete noDefault.directives['default-src'];
  assert.ok(validateBaseline(noDefault).some((e) => /default-src/.test(e)));

  const noScript = clone(REAL);
  delete noScript.directives['script-src'];
  assert.ok(validateBaseline(noScript).some((e) => /script-src/.test(e)));
});

test('script-src unsafe-inline / unsafe-eval / scheme-source are rejected', () => {
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:']) {
    const mutated = clone(REAL);
    mutated.directives['script-src'] = ["'self'", bad];
    assert.ok(
      validateBaseline(mutated).some((e) => /script-src/.test(e)),
      `script-src "${bad}" should be rejected`,
    );
  }
});

test('the real forbidden_tokens list covers *, https:, http:', () => {
  for (const t of ['*', 'https:', 'http:']) {
    assert.ok(FORBIDDEN.includes(t), `forbidden_tokens must include ${t}`);
  }
});

test('DEFAULT_BASELINE_PATH resolves to the committed source of truth', () => {
  assert.match(DEFAULT_BASELINE_PATH.replace(/\\/g, '/'), /docs\/security\/csp-baseline\.json$/);
});
