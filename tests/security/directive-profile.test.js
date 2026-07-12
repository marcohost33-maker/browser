import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadBaseline, CspValidationError } from '../../src/security/csp.js';
import {
  buildHardenedHeaderMap,
  validateHardenedBaseline,
  validateSecurityDirectiveProfile,
} from '../../src/security/header-values.js';

const clone = globalThis.structuredClone ?? ((value) => JSON.parse(JSON.stringify(value)));
const REAL = loadBaseline();

const EXACT_DIRECTIVE_CASES = [
  ['default-src', ["'self'"]],
  ['base-uri', ["'self'"]],
  ['object-src', ["'self'"]],
  ['frame-ancestors', ["'self'"]],
  ['form-action', ["'none'"]],
  ['img-src', ["'self'"]],
  ['style-src', ["'none'"]],
  ['font-src', ["'none'"]],
  ['script-src', ["'self'", "'nonce-YWJjZA=='"]],
  ['manifest-src', ["'none'"]],
  ['worker-src', ["'none'"]],
  ['require-trusted-types-for', []],
  ['upgrade-insecure-requests', ["'self'"]],
];

test('the committed baseline matches the exact APP-01 M1 directive profile', () => {
  assert.deepEqual(validateSecurityDirectiveProfile(REAL), []);
});

for (const [name, weakerOrDriftedValue] of EXACT_DIRECTIVE_CASES) {
  test(`M1 directive drift is rejected for ${name}`, () => {
    const baseline = clone(REAL);
    baseline.directives[name] = weakerOrDriftedValue;

    const errors = validateSecurityDirectiveProfile(baseline);
    assert.ok(errors.some((error) => error.includes(name)), errors.join(' | '));
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  });
}

test('removing a non-fallback directive fails closed', () => {
  const baseline = clone(REAL);
  delete baseline.directives['frame-ancestors'];

  const errors = validateHardenedBaseline(baseline);
  assert.ok(errors.some((error) => /frame-ancestors/.test(error)), errors.join(' | '));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('connect-src must contain self exactly once and in canonical first position', () => {
  for (const sources of [
    ["'self'", "'self'"],
    ['https://mcp.example.com', "'self'"],
    ['https://mcp.example.com'],
  ]) {
    const baseline = clone(REAL);
    baseline.directives['connect-src'] = sources;
    const options = { approvedEndpoints: ['https://mcp.example.com'] };

    const errors = validateSecurityDirectiveProfile(baseline, options);
    assert.ok(errors.length >= 1, `expected ${JSON.stringify(sources)} to be rejected`);
    assert.throws(() => buildHardenedHeaderMap(baseline, options), CspValidationError);
  }
});

test('non-array approved endpoint configuration returns policy errors instead of throwing TypeError', () => {
  const errors = validateHardenedBaseline(REAL, { approvedEndpoints: 42 });
  assert.ok(errors.some((error) => /must be an array/.test(error)), errors.join(' | '));
  assert.throws(
    () => buildHardenedHeaderMap(REAL, { approvedEndpoints: 42 }),
    CspValidationError,
  );
});
