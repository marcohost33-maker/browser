import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServerResponse } from 'node:http';

import { loadBaseline, CspValidationError } from '../../src/security/csp.js';
import {
  applyHardenedSecurityHeaders,
  buildHardenedHeaderMap,
  validateApprovedEndpointOrigins,
  validateHardenedBaseline,
  validateSecurityHeaderValues,
  validateServedHeaderMap,
} from '../../src/security/header-values.js';

const clone = globalThis.structuredClone ?? ((value) => JSON.parse(JSON.stringify(value)));
const REAL = loadBaseline();

function mutatedHeader(name, value) {
  const baseline = clone(REAL);
  baseline.additional_headers[name] = value;
  return baseline;
}

test('HSTS preload is blocked until the deployment and rollback gate is accepted', () => {
  const baseline = mutatedHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  const errors = validateSecurityHeaderValues(baseline);
  assert.ok(errors.some((error) => /preload is blocked/.test(error)), errors.join(' | '));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('Permissions-Policy rejects empty, trailing and unreviewed directives', () => {
  for (const value of [
    `${REAL.additional_headers['Permissions-Policy']},`,
    `,${REAL.additional_headers['Permissions-Policy']}`,
    `${REAL.additional_headers['Permissions-Policy']}, interest-cohort=()`,
  ]) {
    const errors = validateSecurityHeaderValues(mutatedHeader('Permissions-Policy', value));
    assert.ok(errors.length >= 1, `expected ${JSON.stringify(value)} to fail`);
  }
});

test('approved endpoint policy rejects private HTTPS IP literals and trailing-dot hosts', () => {
  for (const origin of [
    'https://10.0.0.1',
    'https://172.16.0.1:8443',
    'https://192.168.1.10',
    'https://169.254.169.254',
    'https://[fd00::1]',
    'https://mcp.example.com.',
  ]) {
    const errors = validateApprovedEndpointOrigins([origin]);
    assert.ok(errors.length >= 1, `expected ${origin} to fail`);
  }
});

test('hardened validation rejects a private origin even when connect-src lists it', () => {
  const origin = 'https://192.168.1.10';
  const baseline = clone(REAL);
  baseline.directives['connect-src'] = ["'self'", origin];
  const errors = validateHardenedBaseline(baseline, { approvedEndpoints: [origin] });
  assert.ok(errors.some((error) => /private\/link-local/.test(error)), errors.join(' | '));
  assert.throws(
    () => buildHardenedHeaderMap(baseline, { approvedEndpoints: [origin] }),
    CspValidationError,
  );
});

test('final served-header validation detects missing, changed and duplicate protected headers', () => {
  const expected = buildHardenedHeaderMap(REAL);
  assert.deepEqual(validateServedHeaderMap(expected, REAL), []);

  const missing = { ...expected };
  delete missing['Content-Security-Policy'];
  assert.ok(validateServedHeaderMap(missing, REAL).some((error) => /missing/.test(error)));

  const changed = { ...expected, 'Referrer-Policy': 'unsafe-url' };
  assert.ok(validateServedHeaderMap(changed, REAL).some((error) => /differs/.test(error)));

  const duplicateEntries = [
    ...Object.entries(expected),
    ['referrer-policy', expected['Referrer-Policy']],
  ];
  assert.ok(
    validateServedHeaderMap(duplicateEntries, REAL).some((error) => /duplicate/.test(error)),
  );
});

test('final served-header validation permits unrelated operational headers', () => {
  const expected = buildHardenedHeaderMap(REAL);
  const actual = { ...expected, 'Cache-Control': 'no-store', 'Content-Type': 'text/html' };
  assert.deepEqual(validateServedHeaderMap(actual, REAL), []);
});

test('applyHardenedSecurityHeaders verifies the Node response boundary', () => {
  const values = new Map();
  const response = {
    setHeader(name, value) {
      values.set(name, value);
    },
    getHeaders() {
      return Object.fromEntries(values);
    },
  };

  const applied = applyHardenedSecurityHeaders(response, REAL);
  assert.deepEqual(Object.fromEntries(values), applied);
});

test('applyHardenedSecurityHeaders fails when response accessors are incomplete', () => {
  assert.throws(
    () => applyHardenedSecurityHeaders({ setHeader() {} }, REAL),
    TypeError,
  );
});
