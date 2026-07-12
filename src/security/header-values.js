// APP-01 exact M1 CSP, response-header and deployment-origin enforcement.
//
// docs/security/csp-baseline.json is the only source of values that are emitted.
// This module is an intentionally independent policy contract: changing the
// baseline requires an explicit matching contract/test/documentation change and
// cannot silently widen the M1 attack surface.

import {
  applySecurityHeaders,
  buildHeaderMap,
  CspValidationError,
  isExactOrigin,
  validateBaseline,
} from './csp.js';

const HSTS_MAX_AGE_FLOOR = 31536000;

const ALLOWED_REFERRER_POLICIES = new Set([
  'no-referrer',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
]);

// Curated M1 deny set. Permissions Policy remains defense in depth: browser
// support differs and must be verified by the ADR-004 browser/E2E matrix.
const REQUIRED_DISABLED_PERMISSIONS = new Set([
  'accelerometer',
  'autoplay',
  'bluetooth',
  'camera',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'local-fonts',
  'local-network',
  'loopback-network',
  'magnetometer',
  'microphone',
  'payment',
  'picture-in-picture',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'usb',
  'xr-spatial-tracking',
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

const REQUIRED_EXACT_DIRECTIVES = new Map([
  ['default-src', ["'none'"]],
  ['base-uri', ["'none'"]],
  ['object-src', ["'none'"]],
  ['frame-ancestors', ["'none'"]],
  ['form-action', ["'self'"]],
  ['img-src', ["'self'", 'data:']],
  ['style-src', ["'self'"]],
  ['font-src', ["'self'"]],
  ['script-src', ["'self'"]],
  ['manifest-src', ["'self'"]],
  ['worker-src', ["'self'"]],
  ['require-trusted-types-for', ["'script'"]],
  ['upgrade-insecure-requests', []],
]);

function arraysEqual(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function validateHsts(value) {
  const errors = [];
  const rawParts = value.split(';');

  if (rawParts.some((part) => part.trim() === '')) {
    errors.push('Strict-Transport-Security contains an empty directive');
  }

  const seen = new Set();
  let maxAge;
  let includeSubDomains = false;
  let preload = false;

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
      preload = true;
    } else {
      errors.push(
        `Strict-Transport-Security contains an unknown or malformed directive ${JSON.stringify(part)}`,
      );
      continue;
    }

    if (seen.has(key)) {
      errors.push(
        `Strict-Transport-Security contains duplicate directive ${JSON.stringify(key)}`,
      );
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
  if (preload) {
    errors.push('Strict-Transport-Security preload is blocked until the deployment/rollback gate is accepted');
  }

  return errors;
}

function validateReferrerPolicy(value) {
  if (!ALLOWED_REFERRER_POLICIES.has(value)) {
    return [
      `Referrer-Policy must be one of ${[...ALLOWED_REFERRER_POLICIES].join(', ')}, got ${JSON.stringify(value)}`,
    ];
  }
  return [];
}

function validatePermissionsPolicy(value) {
  const errors = [];
  const rawDirectives = value.split(',');
  const seen = new Set();

  if (rawDirectives.length === 0 || rawDirectives.some((part) => part.trim() === '')) {
    errors.push('Permissions-Policy contains an empty directive');
  }

  for (const rawDirective of rawDirectives) {
    const directive = rawDirective.trim();
    if (!directive) continue;

    const match = /^([a-z][a-z0-9-]*)\s*=\s*(.+)$/.exec(directive);
    if (!match) {
      errors.push(
        `Permissions-Policy directive is malformed or not lowercase: ${JSON.stringify(directive)}`,
      );
      continue;
    }

    const feature = match[1];
    const allowlist = match[2].trim();

    if (!REQUIRED_DISABLED_PERMISSIONS.has(feature)) {
      errors.push(
        `Permissions-Policy feature ${JSON.stringify(feature)} is not in the reviewed M1 deny set`,
      );
    }
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
      errors.push(
        `Permissions-Policy is missing required disabled feature ${JSON.stringify(feature)}`,
      );
    }
  }

  return errors;
}

function isExplicitLoopbackDevelopmentOrigin(origin) {
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

function parseCanonicalIpv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isNonPublicIpv4(octets) {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function mappedIpv4FromIpv6(hostname) {
  const normalized = hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  if (!normalized.startsWith('::ffff:')) return null;

  const tail = normalized.slice('::ffff:'.length).split(':');
  if (tail.length !== 2 || tail.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  const high = Number.parseInt(tail[0], 16);
  const low = Number.parseInt(tail[1], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isNonPublicAddressLiteral(hostname) {
  const ipv4 = parseCanonicalIpv4(hostname);
  if (ipv4) return isNonPublicIpv4(ipv4);

  const normalized = hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  if (!normalized.includes(':')) return false;

  const mapped = mappedIpv4FromIpv6(hostname);
  if (mapped) return isNonPublicIpv4(mapped);

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    /^fe[c-f]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:') ||
    normalized === '2001:db8::'
  );
}

function isLocalhostName(hostname) {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost');
}

/** Validate deployment-provided CSP origins. */
export function validateApprovedEndpointOrigins(approvedEndpoints = []) {
  if (!Array.isArray(approvedEndpoints)) {
    return ['approvedEndpoints must be an array of exact origins'];
  }

  const errors = [];
  const seen = new Set();

  for (const origin of approvedEndpoints) {
    if (!isExactOrigin(origin)) {
      errors.push(
        `approved endpoint ${JSON.stringify(origin)} is not an exact canonical origin`,
      );
      continue;
    }

    const url = new URL(origin);
    const explicitLoopback = isExplicitLoopbackDevelopmentOrigin(origin);
    if (url.hostname.endsWith('.')) {
      errors.push(`approved endpoint ${JSON.stringify(origin)} has a noncanonical trailing-dot host`);
    }
    if (seen.has(origin)) {
      errors.push(`approved endpoint ${JSON.stringify(origin)} is duplicated`);
      continue;
    }
    seen.add(origin);

    if (url.protocol !== 'https:' && !explicitLoopback) {
      errors.push(
        `approved endpoint ${JSON.stringify(origin)} must use HTTPS; HTTP is restricted to explicit loopback development origins`,
      );
    }
    if (isLocalhostName(url.hostname) && !explicitLoopback) {
      errors.push(
        `approved endpoint ${JSON.stringify(origin)} uses a localhost name outside the explicit development profile`,
      );
    }
    if (isNonPublicAddressLiteral(url.hostname) && !explicitLoopback) {
      errors.push(
        `approved endpoint ${JSON.stringify(origin)} is a non-public/reserved address literal and is blocked by the M1 endpoint profile`,
      );
    }
  }

  return errors;
}

/** Validate the exact APP-01 M1 CSP directive contract. */
export function validateSecurityDirectiveProfile(
  baseline,
  { approvedEndpoints = [] } = {},
) {
  const directives = baseline?.directives;
  if (!directives || typeof directives !== 'object' || Array.isArray(directives)) {
    return ['baseline is missing a "directives" object'];
  }

  const errors = [];
  const allowedNames = new Set([...REQUIRED_EXACT_DIRECTIVES.keys(), 'connect-src']);

  for (const [name, expected] of REQUIRED_EXACT_DIRECTIVES) {
    const actual = directives[name];
    if (!Array.isArray(actual)) {
      errors.push(`required M1 directive ${JSON.stringify(name)} is missing`);
    } else if (!arraysEqual(actual, expected)) {
      errors.push(
        `M1 directive ${JSON.stringify(name)} must equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }

  const connectSrc = directives['connect-src'];
  if (!Array.isArray(connectSrc)) {
    errors.push('required M1 directive "connect-src" is missing');
  } else {
    if (connectSrc[0] !== "'self'") {
      errors.push(`M1 connect-src must begin with "'self'", got ${JSON.stringify(connectSrc)}`);
    }

    const seen = new Set();
    for (const source of connectSrc) {
      if (seen.has(source)) {
        errors.push(`M1 connect-src contains duplicate source ${JSON.stringify(source)}`);
      }
      seen.add(source);
    }
    if (connectSrc.filter((source) => source === "'self'").length !== 1) {
      errors.push('M1 connect-src must contain exactly one "\'self\'" source');
    }

    const approved = new Set(Array.isArray(approvedEndpoints) ? approvedEndpoints : []);
    for (const source of connectSrc.slice(1)) {
      if (!approved.has(source)) {
        errors.push(
          `M1 connect-src source ${JSON.stringify(source)} is not in the approved-endpoint set`,
        );
      }
    }
  }

  for (const name of Object.keys(directives)) {
    if (!allowedNames.has(name)) {
      errors.push(`directive ${JSON.stringify(name)} is not permitted by the APP-01 M1 profile`);
    }
  }
  return errors;
}

/** Validate the exact M1 app-response security-header profile. */
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
    if (!REQUIRED_HEADER_NAMES.has(lower)) {
      errors.push(
        `header ${JSON.stringify(name)} is not permitted in the M1 app-response profile`,
      );
    }
    if (typeof value !== 'string') {
      errors.push(`header ${JSON.stringify(name)} value must be a string`);
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
      errors.push(`${name} must equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  const hsts = byLowerName.get('strict-transport-security');
  if (typeof hsts === 'string') errors.push(...validateHsts(hsts));
  const referrer = byLowerName.get('referrer-policy');
  if (typeof referrer === 'string') errors.push(...validateReferrerPolicy(referrer));
  const permissions = byLowerName.get('permissions-policy');
  if (typeof permissions === 'string') errors.push(...validatePermissionsPolicy(permissions));

  return errors;
}

/** Complete validation used by CI and the serving path. */
export function validateHardenedBaseline(
  baseline,
  { approvedEndpoints = [] } = {},
) {
  const endpointErrors = validateApprovedEndpointOrigins(approvedEndpoints);
  const safeApprovedEndpoints = Array.isArray(approvedEndpoints) ? approvedEndpoints : [];
  return [
    ...validateBaseline(baseline, { approvedEndpoints: safeApprovedEndpoints }),
    ...validateSecurityDirectiveProfile(baseline, {
      approvedEndpoints: safeApprovedEndpoints,
    }),
    ...validateSecurityHeaderValues(baseline),
    ...endpointErrors,
  ];
}

/** Build a served header map only after every policy layer passes. */
export function buildHardenedHeaderMap(baseline, options = {}) {
  const errors = validateHardenedBaseline(baseline, options);
  if (errors.length > 0) throw new CspValidationError(errors);
  return buildHeaderMap(baseline, options);
}

function normalizeHeaderEntries(headers) {
  if (Array.isArray(headers)) return headers;
  if (headers && typeof headers.entries === 'function') return [...headers.entries()];
  if (headers && typeof headers === 'object') return Object.entries(headers);
  return null;
}

/**
 * Verify protected headers at the final response boundary.
 * Extra operational headers are allowed, but protected values cannot be absent,
 * duplicated or changed. Deployment/edge E2E is still required after this call.
 */
export function validateServedHeaderMap(headers, baseline, options = {}) {
  const entries = normalizeHeaderEntries(headers);
  if (!entries) return ['served headers must be an object, Headers-like value or entry array'];

  let expected;
  try {
    expected = buildHardenedHeaderMap(baseline, options);
  } catch (error) {
    if (error instanceof CspValidationError) return [...error.errors];
    throw error;
  }

  const actualByLowerName = new Map();
  const errors = [];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      errors.push(`served header entry is malformed: ${JSON.stringify(entry)}`);
      continue;
    }
    const [name, value] = entry;
    if (typeof name !== 'string' || typeof value !== 'string') {
      errors.push(`served header name/value must be strings: ${JSON.stringify(entry)}`);
      continue;
    }
    const lower = name.toLowerCase();
    if (actualByLowerName.has(lower)) {
      errors.push(`served headers contain duplicate case-insensitive name ${JSON.stringify(lower)}`);
      continue;
    }
    actualByLowerName.set(lower, value);
  }

  for (const [name, value] of Object.entries(expected)) {
    const lower = name.toLowerCase();
    if (!actualByLowerName.has(lower)) {
      errors.push(`served security header ${JSON.stringify(name)} is missing`);
    } else if (actualByLowerName.get(lower) !== value) {
      errors.push(
        `served security header ${JSON.stringify(name)} differs from the hardened value`,
      );
    }
  }
  return errors;
}

/** Apply the hardened map and immediately verify the response object's headers. */
export function applyHardenedSecurityHeaders(res, baseline, options = {}) {
  if (!res || typeof res.setHeader !== 'function' || typeof res.getHeaders !== 'function') {
    throw new TypeError('response must provide setHeader() and getHeaders()');
  }
  const headerMap = buildHardenedHeaderMap(baseline, options);
  applySecurityHeaders(res, headerMap);
  const errors = validateServedHeaderMap(res.getHeaders(), baseline, options);
  if (errors.length > 0) throw new CspValidationError(errors);
  return headerMap;
}
