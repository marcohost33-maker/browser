// APP-01 security-header value validation.
//
// This complements the CSP structural validator in csp.js. It protects the
// machine-readable baseline from value-level downgrades by a compromised or
// mistaken editor and is called by the CLI/serving wrapper before headers are
// emitted.

import { buildHeaderMap, CspValidationError, isExactOrigin } from './csp.js';

const HSTS_MAX_AGE_FLOOR = 31536000;

const ALLOWED_REFERRER_POLICIES = new Set([
  'no-referrer',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
]);

// APP-01's M1 baseline deliberately disables these powerful features.
// Additional directives are allowed only when they are lowercase and disabled
// with the canonical empty inner-list syntax ().
const REQUIRED_DISABLED_PERMISSIONS = new Set([
  'camera',
  'microphone',
  'geolocation',
  'payment',
  'usb',
  'interest-cohort',
]);

const REQUIRED_EXACT_HEADERS = new Map([
  ['x-content-type-options', 'nosniff'],
  ['cross-origin-opener-policy', 'same-origin'],
  ['cross-origin-embedder-policy', 'require-corp'],
  ['cross-origin-resource-policy', 'same-origin'],
  ['x-frame-options', 'DENY'],
]);

const REQUIRED_HEADER_NAMES = new Set([
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'x-frame-options',
]);

function validateHsts(value) {
  const errors = [];
  const rawParts = value.split(';');

  if (rawParts.some((part) => part.trim() === '')) {
    errors.push('Strict-Transport-Security contains an empty directive');
  }

  const seen = new Set();
  let maxAge;
  let includeSubDomains = false;

  for (const rawPart of rawParts) {
    const part = rawPart.trim();
    if (!part) continue;

    const maxAgeMatch = /^max-age=([0-9]+)$/i.exec(part);
    let key;
    if (maxAgeMatch) {
      key = 'max-age';
      const parsed = Number(maxAgeMatch[1]);
      if (!Number.isSafeInteger(parsed)) {
        errors.push('Strict-Transport-Security max-age is not a safe integer');
      } else {
        maxAge = parsed;
      }
    } else if (/^includeSubDomains$/i.test(part)) {
      key = 'includesubdomains';
      includeSubDomains = true;
    } else if (/^preload$/i.test(part)) {
      key = 'preload';
    } else {
      errors.push(`Strict-Transport-Security contains an unknown or malformed directive ${JSON.stringify(part)}`);
      continue;
    }

    if (seen.has(key)) {
      errors.push(`Strict-Transport-Security contains duplicate directive ${JSON.stringify(key)}`);
    }
    seen.add(key);
  }

  if (!seen.has('max-age')) {
    errors.push('Strict-Transport-Security must contain exactly one max-age directive');
  } else if (maxAge < HSTS_MAX_AGE_FLOOR) {
    errors.push(
      `Strict-Transport-Security max-age=${maxAge} is below floor ${HSTS_MAX_AGE_FLOOR}`,
    );
  }

  if (!includeSubDomains) {
    errors.push('Strict-Transport-Security must include includeSubDomains');
  }

  return errors;
}

function validateReferrerPolicy(value) {
  // Canonical lowercase serialization is required. This avoids emitting a token
  // whose browser interpretation differs from the value that was validated.
  if (!ALLOWED_REFERRER_POLICIES.has(value)) {
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
    // HTTP dictionary member names are emitted exactly as written. Requiring
    // lowercase prevents a mixed-case unknown member from being ignored by the
    // browser while our validator mistakenly treats it as a required feature.
    const match = /^([a-z][a-z0-9-]*)\s*=\s*(.+)$/.exec(directive);
    if (!match) {
      errors.push(`Permissions-Policy directive is malformed or not lowercase: ${JSON.stringify(directive)}`);
      continue;
    }

    const feature = match[1];
    const allowlist = match[2].trim();

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

function isLoopbackDevelopmentOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  );
}

/**
 * Validate the deployment-provided exact-origin allowlist.
 * Production origins require HTTPS. Plain HTTP is limited to explicit loopback
 * development endpoints; private-network and arbitrary remote HTTP are denied.
 */
export function validateApprovedEndpointOrigins(approvedEndpoints = []) {
  if (!Array.isArray(approvedEndpoints)) {
    return ['approvedEndpoints must be an array of exact origins'];
  }

  const errors = [];
  const seen = new Set();

  for (const origin of approvedEndpoints) {
    if (!isExactOrigin(origin)) {
      errors.push(`approved endpoint ${JSON.stringify(origin)} is not an exact canonical origin`);
      continue;
    }

    if (seen.has(origin)) {
      errors.push(`approved endpoint ${JSON.stringify(origin)} is duplicated`);
      continue;
    }
    seen.add(origin);

    const url = new URL(origin);
    if (url.protocol !== 'https:' && !isLoopbackDevelopmentOrigin(origin)) {
      errors.push(
        `approved endpoint ${JSON.stringify(origin)} must use HTTPS; HTTP is restricted to localhost, 127.0.0.1 or ::1 development origins`,
      );
    }
  }

  return errors;
}

/**
 * Validate value-level invariants for the complete M1 security-header set.
 * @param {object} baseline parsed csp-baseline.json
 * @returns {string[]} violations
 */
export function validateSecurityHeaderValues(baseline) {
  const additional = baseline?.additional_headers;
  if (!additional || typeof additional !== 'object' || Array.isArray(additional)) {
    return ['baseline is missing an "additional_headers" object'];
  }

  const errors = [];
  const byLowerName = new Map();

  for (const [name, value] of Object.entries(additional)) {
    const lower = name.toLowerCase();
    if (byLowerName.has(lower)) {
      errors.push(
        `additional_headers contains duplicate case-insensitive header name ${JSON.stringify(lower)}`,
      );
      continue;
    }
    byLowerName.set(lower, value);
  }

  for (const name of REQUIRED_HEADER_NAMES) {
    if (!byLowerName.has(name)) {
      errors.push(`required security header ${JSON.stringify(name)} is missing`);
    }
  }

  for (const [name, expected] of REQUIRED_EXACT_HEADERS) {
    const actual = byLowerName.get(name);
    if (typeof actual === 'string' && actual !== expected) {
      errors.push(
        `${name} must equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
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
 * Complete hardened validation used by CI and the serving path.
 */
export function validateHardenedBaseline(
  baseline,
  { approvedEndpoints = [] } = {},
) {
  return [
    ...validateSecurityHeaderValues(baseline),
    ...validateApprovedEndpointOrigins(approvedEndpoints),
  ];
}

/**
 * Build the served header map only after structural CSP validation, complete
 * value validation and deployment endpoint validation have passed.
 */
export function buildHardenedHeaderMap(baseline, options = {}) {
  const errors = validateHardenedBaseline(baseline, options);
  if (errors.length > 0) throw new CspValidationError(errors);
  return buildHeaderMap(baseline, options);
}
