import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadBaseline, CspValidationError } from '../../src/security/csp.js';
import {
  buildHardenedHeaderMap,
  validateHardenedBaseline,
  validateServedHeaderMap,
} from '../../src/security/header-values.js';

const clone = globalThis.structuredClone ?? ((value) => JSON.parse(JSON.stringify(value)));
const REAL = loadBaseline();

for (const [name, value] of [
  ['Content-Security-Policy-Report-Only', "default-src 'none'; report-to attacker"],
  ['Report-To', '{"group":"attacker","endpoints":[{"url":"https://evil.example"}]}'],
  ['Reporting-Endpoints', 'attacker="https://evil.example"'],
  ['NEL', '{"report_to":"attacker","max_age":86400}'],
  ['Timing-Allow-Origin', '*'],
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Allow-Credentials', 'true'],
  ['Set-Cookie', 'session=secret; Secure; HttpOnly'],
  ['Server', 'framework/1.2.3'],
  ['X-Powered-By', 'framework'],
]) {
  test(`final response rejects security-sensitive extra header ${name}`, () => {
    const actual = {
      ...buildHardenedHeaderMap(REAL),
      [name]: value,
    };
    const errors = validateServedHeaderMap(actual, REAL);
    assert.ok(
      errors.some((error) => /forbidden M1 header/.test(error)),
      errors.join(' | '),
    );
  });
}

test('baseline metadata rejects unknown top-level properties', () => {
  const baseline = clone(REAL);
  baseline.shadow_policy = { allow: '*' };
  const errors = validateHardenedBaseline(baseline);
  assert.ok(errors.some((error) => /unreviewed top-level key/.test(error)));
  assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
});

test('connect-src policy metadata is a checked contract, not unaudited prose', () => {
  for (const mutate of [
    (policy) => { policy.seed = ["'none'"]; },
    (policy) => { policy.append_only_from = 'user-input'; },
    (policy) => { policy.forbidden_tokens = ['*']; },
    (policy) => { policy.match = 'wildcard'; },
    (policy) => { policy.extra = true; },
  ]) {
    const baseline = clone(REAL);
    mutate(baseline.connect_src_policy);
    const errors = validateHardenedBaseline(baseline);
    assert.ok(errors.length >= 1, 'mutated metadata must fail closed');
    assert.throws(() => buildHardenedHeaderMap(baseline), CspValidationError);
  }
});

test('baseline version and date metadata use canonical forms', () => {
  for (const [key, value] of [
    ['version', 'v0.2'],
    ['date', '12-07-2026'],
    ['$schema-note', ''],
  ]) {
    const baseline = clone(REAL);
    baseline[key] = value;
    assert.ok(validateHardenedBaseline(baseline).length >= 1);
  }
});
