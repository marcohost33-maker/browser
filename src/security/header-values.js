// APP-01 security-header value validation.
//
// This complements the CSP structural validator in csp.js. It protects the
// machine-readable baseline from value-level downgrades by a compromised or
// mistaken editor and is called by the CLI/serving wrapper before headers are
// emitted.

import { buildHeaderMap, CspValidationError } from './csp.js';

const ALLOWED_REFERRER_POLICIES = new Set([
  'no-referrer',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
]);

// APP-01's M1 baseline deliberately disables these powerful features.
// Additional directives are allowed only when they are also disabled with ().
const REQUIRED_DISABLED_PERMISSIONS = new Set([
  'camera',
  'microphone',
  'geolocation',
  'payment',
  'usb',
  'interest-cohort',
]);

function validateHsts(value) {
  const errors = [];
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  const maxAgeParts = parts.filter((part) => /^max-age\s*=/i.test(part));
  if (maxAgeParts.length !== 1) {
    errors.push('Strict-Transport-Security must contain exactly one max-age directive');
  }

  if (!parts.some((part) => /^includeSubDomains$/i.test(part))) {
    errors.push('Strict-Transport-Security must include includeSubDomains');
  }

  return errors;
}

function validateReferrerPolicy(value) {
  const normalized = value.trim().toLowerCase();
  if (!ALLOWED_REFERRER_POLICIES.has(normalized)) {
    return [
      `Referrer-Policy must be one of ${[...ALLOWED_REFERRER_POLICIES].join(', ')}, got ${JSON.stringify(value)}`,
    ];
  }
  return [];
}

function validatePermissionsPolicy(value) {
  const errors = [];
  const seen = new Set();
  const directives = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (directives.length === 0) {
    return ['Permissions-Policy must contain explicit disabled feature directives'];
  }

  for (const directive of directives) {
    const match = /^([a-z][a-z0-9-]*)\s*=\s*(.+)$/i.exec(directive);
    if (!match) {
      errors.push(`Permissions-Policy directive is malformed: ${JSON.stringify(directive)}`);
      continue;
    }

    const feature = match[1].toLowerCase();
    const allowlist = match[2].replace(/\s+/g, '');

    if (seen.has(feature)) {
      errors.push(`Permissions-Policy contains duplicate feature ${JSON.stringify(feature)}`);
      continue;
    }
    seen.add(feature);

    if (allowlist !== '()') {
      errors.push(
        `Permissions-Policy feature ${JSON.stringify(feature)} must be disabled with (), got ${JSON.stringify(match[2])}`,
      );
    }
  }

  for (const feature of REQUIRED_DISABLED_PERMISSIONS) {
    if (!seen.has(feature)) {
      errors.push(`Permissions-Policy is missing required disabled feature ${JSON.stringify(feature)}`);
    }
  }

  return errors;
}

/**
 * Validate value-level invariants for the high-value additional headers.
 * @param {object} baseline parsed csp-baseline.json
 * @returns {string[]} violations
 */
export function validateSecurityHeaderValues(baseline) {
  const additional = baseline?.additional_headers;
  if (!additional || typeof additional !== 'object') {
    return ['baseline is missing an "additional_headers" object'];
  }

  const byLowerName = new Map(
    Object.entries(additional).map(([name, value]) => [name.toLowerCase(), value]),
  );

  const required = [
    'strict-transport-security',
    'referrer-policy',
    'permissions-policy',
  ];
  const errors = [];

  for (const name of required) {
    if (!byLowerName.has(name)) {
      errors.push(`required security header ${JSON.stringify(name)} is missing`);
    }
  }

  const hsts = byLowerName.get('strict-transport-security');
  if (typeof hsts === 'string') errors.push(...validateHsts(hsts));

  const referrer = byLowerName.get('referrer-policy');
  if (typeof referrer === 'string') errors.push(...validateReferrerPolicy(referrer));

  const permissions = byLowerName.get('permissions-policy');
  if (typeof permissions === 'string') {
    errors.push(...validatePermissionsPolicy(permissions));
  }

  return errors;
}

/**
 * Build the served header map only after both structural CSP validation and
 * value-level security-header validation have passed.
 */
export function buildHardenedHeaderMap(baseline, options = {}) {
  const errors = validateSecurityHeaderValues(baseline);
  if (errors.length > 0) throw new CspValidationError(errors);
  return buildHeaderMap(baseline, options);
}
