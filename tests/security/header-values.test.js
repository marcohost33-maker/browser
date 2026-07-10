import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadBaseline, CspValidationError } from '../../src/security/csp.js';
import {
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

test('real committed security-header baseline passes value validation', () => {
  assert.deepEqual(validateSecurityHeaderValues(REAL), []);
  assert.ok(buildHardenedHeaderMap(REAL)['Content-Security-Policy']);
});

for (const unsafe of [
  'unsafe-url',
  'no-referrer-when-downgrade',
  'origin-when-cross-origin',
  'origin',
]) {
  test(`Referrer-Policy downgrade ${unsafe} is rejected`, () => {
    const baseline = mutatedHeader('Referrer-Policy', unsafe);
    const errors = validateSecurityHeaderValues(baseline);
    assert.ok(errors.some((error) => /Referrer-Policy/.test(error)));
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  });
}

for (const safe of [
  'no-referrer',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
]) {
  test(`Referrer-Policy ${safe} is accepted`, () => {
    const baseline = mutatedHeader('Referrer-Policy', safe);
    assert.deepEqual(validateSecurityHeaderValues(baseline), []);
  });
}

test('Permissions-Policy rejects self grant for a disabled feature', () => {
  const baseline = mutatedHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /geolocation/.test(error)));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('Permissions-Policy rejects a foreign-origin grant', () => {
  const baseline = mutatedHeader(
    'Permissions-Policy',
    'camera=(self "https://evil.example"), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /camera/.test(error)));
});

test('Permissions-Policy rejects missing required disabled features', () => {
  const baseline = mutatedHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /payment/.test(error)));
  assert.ok(errors.some((error) => /usb/.test(error)));
});

test('Permissions-Policy rejects duplicate feature directives', () => {
  const baseline = mutatedHeader(
    'Permissions-Policy',
    'camera=(), camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  assert.ok(
    validateSecurityHeaderValues(baseline).some((error) => /duplicate feature/.test(error)),
  );
});

test('HSTS without includeSubDomains is rejected', () => {
  const baseline = mutatedHeader(
    'Strict-Transport-Security',
    'max-age=63072000; preload',
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /includeSubDomains/.test(error)));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('HSTS with duplicate max-age is rejected', () => {
  const baseline = mutatedHeader(
    'Strict-Transport-Security',
    'max-age=63072000; max-age=31536000; includeSubDomains',
  );
  assert.ok(
    validateSecurityHeaderValues(baseline).some((error) => /exactly one max-age/.test(error)),
  );
});

test('missing high-value security headers are rejected', () => {
  for (const name of [
    'Strict-Transport-Security',
    'Referrer-Policy',
    'Permissions-Policy',
  ]) {
    const baseline = clone(REAL);
    delete baseline.additional_headers[name];
    assert.ok(
      validateSecurityHeaderValues(baseline).some((error) => /is missing/.test(error)),
      `${name} should be required`,
    );
  }
});
