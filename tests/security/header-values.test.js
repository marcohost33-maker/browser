import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadBaseline, CspValidationError } from '../../src/security/csp.js';
import {
  validateApprovedEndpointOrigins,
  validateHardenedBaseline,
  validateSecurityHeaderValues,
  buildHardenedHeaderMap,
} from '../../src/security/header-values.js';

const clone = globalThis.structuredClone ?? ((value) => JSON.parse(JSON.stringify(value)));
const REAL = loadBaseline();

function mutatedHeader(name, value) {
  const baseline = clone(REAL);
  baseline.additional_headers[name] = value;
  return baseline;
}

function baselineWithEndpoint(origin) {
  const baseline = clone(REAL);
  baseline.directives['connect-src'] = ["'self'", origin];
  return baseline;
}

function mutatedPermissions(mutator) {
  return mutatedHeader(
    'Permissions-Policy',
    mutator(REAL.additional_headers['Permissions-Policy']),
  );
}

test('real committed security-header baseline passes complete hardening', () => {
  assert.deepEqual(validateHardenedBaseline(REAL), []);
  assert.ok(buildHardenedHeaderMap(REAL)['Content-Security-Policy']);
});

test('case-insensitive duplicate headers are rejected before emission', () => {
  const baseline = clone(REAL);
  const { 'Strict-Transport-Security': _removed, ...rest } = baseline.additional_headers;
  baseline.additional_headers = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    ...rest,
  };

  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /duplicate case-insensitive header name/.test(error)));
  assert.ok(errors.some((error) => /63072000/.test(error)));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

for (const unsafe of [
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
  'no-referrer-when-downgrade',
  'origin-when-cross-origin',
  'origin',
  'NO-REFERRER',
  ' no-referrer',
]) {
  test(`Referrer-Policy drift ${JSON.stringify(unsafe)} is rejected`, () => {
    const baseline = mutatedHeader('Referrer-Policy', unsafe);
    const errors = validateSecurityHeaderValues(baseline);
    assert.ok(errors.some((error) => /Referrer-Policy/.test(error)));
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  });
}

test('only exact no-referrer remains accepted', () => {
  assert.deepEqual(
    validateSecurityHeaderValues(mutatedHeader('Referrer-Policy', 'no-referrer')),
    [],
  );
});

test('Permissions-Policy rejects self grant for a disabled feature', () => {
  const baseline = mutatedPermissions((value) =>
    value.replace('geolocation=()', 'geolocation=(self)'),
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /geolocation/.test(error)));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('Permissions-Policy rejects a foreign-origin grant', () => {
  const baseline = mutatedPermissions((value) =>
    value.replace('camera=()', 'camera=(self "https://evil.example")'),
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /camera/.test(error)));
});

test('Permissions-Policy rejects mixed-case feature names', () => {
  const baseline = mutatedPermissions((value) => value.replace('camera=()', 'Camera=()'));
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /not lowercase/.test(error)));
  assert.ok(errors.some((error) => /missing required disabled feature/.test(error)));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('Permissions-Policy rejects missing required disabled features', () => {
  const baseline = mutatedPermissions((value) => value.replace('payment=(), ', ''));
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /payment/.test(error)));
});

test('Permissions-Policy rejects duplicate feature directives', () => {
  const baseline = mutatedPermissions((value) => `camera=(), ${value}`);
  assert.ok(
    validateSecurityHeaderValues(baseline).some((error) => /duplicate feature/.test(error)),
  );
});

test('Permissions-Policy rejects semantically equal but noncanonical ordering', () => {
  const baseline = mutatedPermissions((value) => value.split(', ').reverse().join(', '));
  assert.ok(
    validateSecurityHeaderValues(baseline).some((error) => /canonical reviewed/.test(error)),
  );
});

test('HSTS without includeSubDomains is rejected', () => {
  const baseline = mutatedHeader('Strict-Transport-Security', 'max-age=63072000');
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /includeSubDomains/.test(error)));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

for (const unsafe of [
  'max-age=63072000; max-age=31536000; includeSubDomains',
  'max-age=63072000; includeSubDomains; includeSubDomains',
  'max-age=63072000junk; includeSubDomains',
  'max-age = 63072000; includeSubDomains',
  'max-age=63072000; includeSubDomains; unknown',
  'max-age=63072000; includeSubDomains;',
  'max-age=10; includeSubDomains',
  'max-age=31536000; includeSubDomains',
  'max-age=63072001; includeSubDomains',
  'includeSubDomains; max-age=63072000',
]) {
  test(`malformed, weakened or noncanonical HSTS ${JSON.stringify(unsafe)} is rejected`, () => {
    const baseline = mutatedHeader('Strict-Transport-Security', unsafe);
    assert.ok(validateSecurityHeaderValues(baseline).length >= 1);
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  });
}

const REQUIRED_HEADERS = [
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'Cross-Origin-Embedder-Policy',
  'Cross-Origin-Resource-Policy',
  'X-Frame-Options',
];

test('every M1 security header is required', () => {
  for (const name of REQUIRED_HEADERS) {
    const baseline = clone(REAL);
    delete baseline.additional_headers[name];
    assert.ok(
      validateSecurityHeaderValues(baseline).some((error) => /is missing/.test(error)),
      `${name} should be required`,
    );
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  }
});

for (const [name, unsafe] of [
  ['X-Content-Type-Options', 'sniff'],
  ['Cross-Origin-Opener-Policy', 'same-origin-allow-popups'],
  ['Cross-Origin-Embedder-Policy', 'credentialless'],
  ['Cross-Origin-Resource-Policy', 'same-site'],
  ['X-Frame-Options', 'SAMEORIGIN'],
]) {
  test(`${name} downgrade ${unsafe} is rejected by the M1 policy`, () => {
    const baseline = mutatedHeader(name, unsafe);
    const errors = validateSecurityHeaderValues(baseline);
    assert.ok(errors.some((error) => error.includes(name.toLowerCase())));
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  });
}

test('HTTPS approved endpoint is accepted and emitted when explicitly allowlisted', () => {
  const origin = 'https://mcp.example.com';
  const baseline = baselineWithEndpoint(origin);
  const options = { approvedEndpoints: [origin] };
  assert.deepEqual(validateHardenedBaseline(baseline, options), []);
  assert.match(
    buildHardenedHeaderMap(baseline, options)['Content-Security-Policy'],
    /https:\/\/mcp\.example\.com/,
  );
});

for (const origin of [
  'http://localhost:3000',
  'http://127.0.0.1:8000',
  'http://[::1]:9000',
]) {
  test(`explicit loopback development endpoint ${origin} is accepted`, () => {
    assert.deepEqual(validateApprovedEndpointOrigins([origin]), []);
    const baseline = baselineWithEndpoint(origin);
    assert.deepEqual(
      validateHardenedBaseline(baseline, { approvedEndpoints: [origin] }),
      [],
    );
  });
}

for (const origin of [
  'http://mcp.example.com',
  'http://10.0.0.1',
  'http://192.168.1.10:8080',
  'ftp://mcp.example.com',
]) {
  test(`unsafe approved endpoint ${origin} is rejected`, () => {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(errors.length >= 1);
    assert.throws(
      () => buildHardenedHeaderMap(REAL, { approvedEndpoints: [origin] }),
      CspValidationError,
    );
  });
}

test('non-canonical and duplicate approved endpoints are rejected', () => {
  assert.ok(validateApprovedEndpointOrigins(['https://EXAMPLE.com']).length >= 1);
  assert.ok(validateApprovedEndpointOrigins(['https://example.com/']).length >= 1);
  assert.ok(
    validateApprovedEndpointOrigins([
      'https://example.com',
      'https://example.com',
    ]).some((error) => /duplicated/.test(error)),
  );
});

test('approved endpoint input must be an array', () => {
  assert.deepEqual(validateApprovedEndpointOrigins('https://example.com'), [
    'approvedEndpoints must be an array of exact origins',
  ]);
});
