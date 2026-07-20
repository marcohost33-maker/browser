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

const REQUIRED_HSTS_VALUE = 'max-age=63072000; includeSubDomains';
const REQUIRED_REFERRER_POLICY = 'no-referrer';

// Curated M1 deny set. Permissions Policy remains defense in depth: browser
// support differs and must be verified by the ADR-004 browser/E2E matrix.
const REQUIRED_DISABLED_PERMISSIONS = [
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
];
const REQUIRED_DISABLED_PERMISSION_SET = new Set(REQUIRED_DISABLED_PERMISSIONS);
const REQUIRED_PERMISSIONS_POLICY = REQUIRED_DISABLED_PERMISSIONS
  .map((feature) => `${feature}=()`)
  .join(', ');

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

// Headers that reverse M1 trust directions, emit sensitive browser reports,
// introduce state, or disclose implementation details. These remain forbidden
// even when supplied after the baseline-derived map has been applied.
const FORBIDDEN_SERVED_HEADER_NAMES = new Set([
  'content-security-policy-report-only',
  'report-to',
  'reporting-endpoints',
  'nel',
  'timing-allow-origin',
  'set-cookie',
  'set-cookie2',
  'server',
  'x-powered-by',
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

const REQUIRED_TOP_LEVEL_KEYS = new Set([
  '$schema-note',
  'version',
  'date',
  'directives',
  'connect_src_policy',
  'additional_headers',
]);

const REQUIRED_CONNECT_SRC_POLICY = {
  seed: ["'self'"],
  append_only_from: 'approved-endpoint-set',
  forbidden_tokens: [
    '*',
    'https:',
    'http:',
    'data:',
    'blob:',
    "'unsafe-inline'",
    "'unsafe-eval'",
  ],
  match: 'exact-canonical-origin',
};

function arraysEqual(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function validateBaselineMetadata(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return ['baseline must be an object'];
  }

  const errors = [];
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(baseline, key)) {
      errors.push(`baseline is missing required top-level key ${JSON.stringify(key)}`);
    }
  }
  for (const key of Object.keys(baseline)) {
    if (!REQUIRED_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`baseline contains unreviewed top-level key ${JSON.stringify(key)}`);
    }
  }

  if (typeof baseline['$schema-note'] !== 'string' || baseline['$schema-note'].trim() === '') {
    errors.push('baseline $schema-note must be a non-empty string');
  }
  if (typeof baseline.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(baseline.version)) {
    errors.push(`baseline version must be exact semantic version, got ${JSON.stringify(baseline.version)}`);
  }
  if (typeof baseline.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(baseline.date)) {
    errors.push(`baseline date must be YYYY-MM-DD, got ${JSON.stringify(baseline.date)}`);
  }

  const policy = baseline.connect_src_policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    errors.push('baseline connect_src_policy must be an object');
    return errors;
  }

  const allowedPolicyKeys = new Set([
    'seed',
    'append_only_from',
    'forbidden_tokens',
    'match',
    'note',
  ]);
  for (const key of Object.keys(policy)) {
    if (!allowedPolicyKeys.has(key)) {
      errors.push(`connect_src_policy contains unreviewed key ${JSON.stringify(key)}`);
    }
  }
  for (const key of allowedPolicyKeys) {
    if (!Object.hasOwn(policy, key)) {
      errors.push(`connect_src_policy is missing required key ${JSON.stringify(key)}`);
    }
  }

  if (!Array.isArray(policy.seed) || !arraysEqual(policy.seed, REQUIRED_CONNECT_SRC_POLICY.seed)) {
    errors.push(`connect_src_policy.seed must equal ${JSON.stringify(REQUIRED_CONNECT_SRC_POLICY.seed)}`);
  }
  if (policy.append_only_from !== REQUIRED_CONNECT_SRC_POLICY.append_only_from) {
    errors.push(
      `connect_src_policy.append_only_from must equal ${JSON.stringify(REQUIRED_CONNECT_SRC_POLICY.append_only_from)}`,
    );
  }
  if (
    !Array.isArray(policy.forbidden_tokens) ||
    !arraysEqual(policy.forbidden_tokens, REQUIRED_CONNECT_SRC_POLICY.forbidden_tokens)
  ) {
    errors.push(
      `connect_src_policy.forbidden_tokens must equal ${JSON.stringify(REQUIRED_CONNECT_SRC_POLICY.forbidden_tokens)}`,
    );
  }
  if (policy.match !== REQUIRED_CONNECT_SRC_POLICY.match) {
    errors.push(
      `connect_src_policy.match must equal ${JSON.stringify(REQUIRED_CONNECT_SRC_POLICY.match)}`,
    );
  }
  if (typeof policy.note !== 'string' || policy.note.trim() === '') {
    errors.push('connect_src_policy.note must be a non-empty string');
  }

  return errors;
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
  } else if (maxAge !== 63072000) {
    errors.push('Strict-Transport-Security max-age must remain exactly 63072000 seconds');
  }
  if (!includeSubDomains) {
    errors.push('Strict-Transport-Security must include includeSubDomains');
  }
  if (preload) {
    errors.push('Strict-Transport-Security preload is blocked until the deployment/rollback gate is accepted');
  }
  if (value !== REQUIRED_HSTS_VALUE) {
    errors.push(
      `Strict-Transport-Security must use canonical M1 value ${JSON.stringify(REQUIRED_HSTS_VALUE)}`,
    );
  }

  return errors;
}

function validateReferrerPolicy(value) {
  if (value !== REQUIRED_REFERRER_POLICY) {
    return [
      `Referrer-Policy must remain exactly ${JSON.stringify(REQUIRED_REFERRER_POLICY)}, got ${JSON.stringify(value)}`,
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

    if (!REQUIRED_DISABLED_PERMISSION_SET.has(feature)) {
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
  if (value !== REQUIRED_PERMISSIONS_POLICY) {
    errors.push('Permissions-Policy must use the canonical reviewed M1 ordering and serialization');
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
    // 192.0.0.0/24 (IETF Protocol Assignments) and 192.0.2.0/24 (TEST-NET-1)
    // are special-use; 192.0.1.0/24 etc. is ordinary public space.
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/**
 * Expand an IPv6 literal to exactly eight 16-bit groups, resolving `::`
 * compression and a trailing dotted-quad IPv4 tail. Returns null when the
 * input is not a syntactically valid IPv6 address. Prefixes/scopes (`%zone`)
 * are rejected so canonicalization stays unambiguous.
 */
function expandIpv6(hostname) {
  const normalized = hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  if (!normalized.includes(':') || normalized.includes('%')) return null;
  if ((normalized.match(/::/g) || []).length > 1) return null;

  const [headPart, tailPart, ...extra] = normalized.split('::');
  if (extra.length > 0) return null;
  const hasCompression = tailPart !== undefined;

  const head = headPart === '' ? [] : headPart.split(':');
  const tail = !hasCompression ? [] : tailPart === '' ? [] : tailPart.split(':');

  // A trailing dotted-quad IPv4 tail contributes two 16-bit groups.
  const groups = [];
  const consume = (segments, dest) => {
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.includes('.')) {
        if (i !== segments.length - 1) return false;
        const octets = parseCanonicalIpv4(seg);
        if (!octets) return false;
        dest.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(seg)) return false;
        dest.push(Number.parseInt(seg, 16));
      }
    }
    return true;
  };

  const headGroups = [];
  const tailGroups = [];
  if (!consume(head, headGroups)) return null;
  if (!consume(tail, tailGroups)) return null;

  if (hasCompression) {
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 1) return null;
    groups.push(...headGroups, ...new Array(fill).fill(0), ...tailGroups);
  } else {
    groups.push(...headGroups);
  }
  if (groups.length !== 8) return null;
  return groups;
}

/**
 * Return the embedded IPv4 octets when the IPv6 address carries one in a
 * transition range that aliases an IPv4 host, so a private target cannot be
 * smuggled past the allowlist by spelling it as IPv6. Handled forms:
 *   - IPv4-mapped        `::ffff:0:0/96`   (RFC 4291)
 *   - IPv4-compatible    `::/96`           (deprecated, RFC 4291)
 *   - NAT64 well-known   `64:ff9b::/96`    (RFC 6052)
 *   - 6to4               `2002::/16`       (RFC 3056) — the only transition
 *     form that sits inside accept-by-default global unicast, so it is the
 *     one residual embedding risk for an allowlist.
 * Known residual limitations (exotic / obfuscated encodings, not decoded
 * here): Teredo `2001:0::/32` (XOR-obfuscated), ISATAP `::5efe:a.b.c.d`, and
 * NAT64 local-use `64:ff9b:1::/48`. A browser cannot resolve DNS, so the
 * defence-in-depth stops at literal decoding; revisit if a resolved-IP check
 * is ever added. See docs/research + Codex PR#17 review.
 */
function embeddedIpv4FromIpv6(groups) {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const zeroTo5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  const isMapped = zeroTo5 && g5 === 0xffff;
  const isCompatible = zeroTo5 && g5 === 0;
  const isNat64 = g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (isMapped || isCompatible || isNat64) {
    return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  }
  if (g0 === 0x2002) {
    // 6to4: the IPv4 address occupies the two groups after the 2002 prefix.
    return [g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff];
  }
  return null;
}

function isNonPublicAddressLiteral(hostname) {
  const ipv4 = parseCanonicalIpv4(hostname);
  if (ipv4) return isNonPublicIpv4(ipv4);

  const groups = expandIpv6(hostname);
  if (!groups) return false;

  const embedded = embeddedIpv4FromIpv6(groups);
  if (embedded) return isNonPublicIpv4(embedded);

  const [g0, g1] = groups;
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  return (
    isUnspecified || // ::/128
    isLoopback || // ::1/128
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g0 & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
    (g0 & 0xff00) === 0xff00 || // ff00::/8 multicast
    (g0 === 0x2001 && g1 === 0x0db8) // 2001:db8::/32 documentation
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
    ...validateBaselineMetadata(baseline),
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
 * duplicated or changed. Security-sensitive extra headers remain forbidden.
 * Deployment/edge E2E is still required after this call.
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
    if (FORBIDDEN_SERVED_HEADER_NAMES.has(lower) || lower.startsWith('access-control-')) {
      errors.push(`served response contains forbidden M1 header ${JSON.stringify(name)}`);
    }
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
