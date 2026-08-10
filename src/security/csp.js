// APP-01 CSP + security-header serializer + enforcement (M1B).
//
// Single source of truth: docs/security/csp-baseline.json. This module turns
// that machine-readable baseline into the exact header strings the app serves,
// and enforces the *whole served surface* — every CSP directive plus every
// additional header — at build/CI time. It is validate-then-serialize: a
// baseline that would emit an unsafe policy is rejected fail-closed and can
// never be serialized/served.
//
// Threat handled (Aegis PoC, 2026-07-10): a `;`/whitespace-carrying source
// token in ANY directive (e.g. default-src) injects an extra widening
// directive (`connect-src * data: https://evil`) into the serialized string,
// and a raw `additional_headers` value downgrades HSTS to max-age=0. Both are
// rejected here.
//
// No runtime dependencies (Node built-ins only).
//
// See docs/security/CSP_AND_SECURITY_HEADERS.md for the security rationale.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo-root-relative default path to the single source of truth.
export const DEFAULT_BASELINE_PATH = resolve(
  __dirname,
  '..',
  '..',
  'docs',
  'security',
  'csp-baseline.json',
);

// Directives whose value list is empty are boolean/valueless directives
// (e.g. upgrade-insecure-requests) and are serialized as the name alone.
const VALUELESS_DIRECTIVES = new Set(['upgrade-insecure-requests']);

// Directives that MUST be present in a served baseline. Absence is fail-closed
// treated as a spec violation (a missing connect-src silently falls back to
// default-src; we require it explicit so the exfil boundary is auditable).
const REQUIRED_DIRECTIVES = ['default-src', 'connect-src', 'script-src'];

// Any source token containing a directive-/policy-/source separator or a
// control char is an injection vector — a legitimate CSP source never does.
// Rejecting these kills `;`-injection (extra directive) and header-splitting.
const ILLEGAL_SOURCE_CHARS = /[\s;,]|[\x00-\x1f\x7f]/;

// Control-char guard for header VALUES (header-splitting / CRLF injection).
const HEADER_CTRL_CHARS = /[\x00-\x1f\x7f]/;

// Strict nonce/hash source patterns (only place a non-keyword quoted token is
// allowed, and only in directives that opt in).
const NONCE_RE = /^'nonce-[A-Za-z0-9+/\-_]+={0,2}'$/;
const HASH_RE = /^'sha(256|384|512)-[A-Za-z0-9+/\-_]+={0,2}'$/;

// A scheme-source shorthand like https: http: data: blob: ws:
const SCHEME_SOURCE_RE = /^[a-z][a-z0-9+.\-]*:$/i;

// HSTS must not be downgraded. Floor = 1 year (common preload minimum).
const HSTS_MAX_AGE_FLOOR = 31536000;

// The ONLY header names permitted in additional_headers (fail-closed: anything
// else is rejected rather than passed through verbatim). Lowercased for
// case-insensitive matching.
const ALLOWED_ADDITIONAL_HEADERS = new Set([
  'strict-transport-security',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'x-frame-options',
  'access-control-allow-origin',
]);

// The CSP MUST come exclusively from `directives`. An additional_headers key
// (any case) that (re)defines the policy — or a Report-Only twin that can
// shadow it / exfiltrate violation reports — overrides the generated CSP on the
// wire and re-opens the exfil boundary. Rejected fail-closed.
const FORBIDDEN_ADDITIONAL_HEADER_NAMES = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
]);

// Per-directive policy. `keywords` = the exact quoted keywords allowed;
// `schemes` = the scheme-sources allowed (only img-/font-style contexts);
// `nonceHash` = accept nonces/hashes; `approvedOrigins` = accept exact origins
// present in the curated approved-endpoint set. Anything else is rejected.
// A directive NOT in this table is an unknown directive and is rejected.
const DIRECTIVE_POLICY = {
  'default-src': { keywords: ["'none'", "'self'"] },
  'base-uri': { keywords: ["'none'", "'self'"] },
  'object-src': { keywords: ["'none'", "'self'"] },
  'frame-ancestors': { keywords: ["'none'", "'self'"] },
  'form-action': { keywords: ["'none'", "'self'"] },
  'img-src': { keywords: ["'none'", "'self'"], schemes: ['data:'] },
  'style-src': { keywords: ["'none'", "'self'"] },
  'font-src': { keywords: ["'none'", "'self'"] },
  'script-src': { keywords: ["'none'", "'self'"], nonceHash: true },
  'connect-src': { keywords: ["'none'", "'self'"], approvedOrigins: true },
  'manifest-src': { keywords: ["'none'", "'self'"] },
  'worker-src': { keywords: ["'none'", "'self'"] },
  'require-trusted-types-for': { keywords: ["'script'"] },
  // Companion to require-trusted-types-for: restrict which Trusted Types policy
  // names may be created. "'none'" forbids policy creation entirely (the strict
  // default), so a compromised script cannot register its own permissive policy
  // to route raw strings back into DOM XSS sinks. See MDN CSP: trusted-types.
  'trusted-types': { keywords: ["'none'"] },
  'upgrade-insecure-requests': { valueless: true },
};

// Whitelist of directive NAMES the serializer may emit: the policy table keys
// plus the known valueless directives. Any other name is an injected/unknown
// directive and is refused fail-closed at serialization time.
const KNOWN_DIRECTIVE_NAMES = new Set([
  ...Object.keys(DIRECTIVE_POLICY),
  ...VALUELESS_DIRECTIVES,
]);

// Custom error carrying the full list of violations for CI reporting.
export class CspValidationError extends Error {
  constructor(errors) {
    super(
      `CSP baseline validation failed with ${errors.length} error(s):\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
    this.name = 'CspValidationError';
    this.errors = errors;
  }
}

/**
 * Read and parse the machine-readable CSP baseline.
 * @param {string} [path] absolute path to csp-baseline.json
 * @returns {object} parsed baseline
 */
export function loadBaseline(path = DEFAULT_BASELINE_PATH) {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.directives) {
    throw new CspValidationError(['baseline is missing a "directives" object']);
  }
  return parsed;
}

/**
 * Is `src` an exact origin (scheme://host[:port]) with no path, query, wildcard
 * or scheme-only shorthand? This is what "match: exact-origin" requires.
 * @param {string} src
 * @returns {boolean}
 */
export function isExactOrigin(src) {
  if (typeof src !== 'string' || src.includes('*')) return false;
  let url;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (!url.host) return false;
  // A trailing-dot host (`example.com.`) is a distinct, non-canonical spelling
  // of the FQDN that a browser resolves to the same target — treat it as a
  // non-exact origin (defence in depth vs. canonicalization bypass).
  if (url.hostname.endsWith('.')) return false;
  return url.origin === src && url.origin !== 'null';
}

/**
 * Validate a single source token for one directive against its policy.
 * @returns {string[]} violations for this token (empty = clean)
 */
function validateSource(directive, src, policy, approved) {
  const errors = [];
  if (typeof src !== 'string') {
    // Equalita wart: null/number must surface as a violation, not a TypeError.
    errors.push(`${directive} contains a non-string source (${JSON.stringify(src)})`);
    return errors;
  }
  if (ILLEGAL_SOURCE_CHARS.test(src)) {
    errors.push(
      `${directive} source ${JSON.stringify(src)} contains an illegal ` +
        `separator/control char (injection vector)`,
    );
    return errors; // do not further interpret an injection payload
  }
  if (src.includes('*')) {
    errors.push(`${directive} contains wildcard ${JSON.stringify(src)}`);
    return errors;
  }
  // Quoted keyword (e.g. 'self', 'none', 'unsafe-inline', nonce/hash).
  if (src.startsWith("'") && src.endsWith("'")) {
    if ((policy.keywords || []).includes(src)) return errors;
    if (policy.nonceHash && (NONCE_RE.test(src) || HASH_RE.test(src))) return errors;
    errors.push(`${directive} contains disallowed keyword ${src}`);
    return errors;
  }
  // Scheme-source (https:, http:, data:, blob:, ws:, wss: ...).
  if (SCHEME_SOURCE_RE.test(src)) {
    if ((policy.schemes || []).includes(src)) return errors;
    errors.push(`${directive} contains scheme-source ${JSON.stringify(src)} (widens surface)`);
    return errors;
  }
  // Otherwise it must be an exact origin, and only where origins are allowed
  // and only if it is in the curated approved-endpoint set.
  if (!policy.approvedOrigins) {
    errors.push(`${directive} does not permit host/origin sources: ${JSON.stringify(src)}`);
    return errors;
  }
  if (!isExactOrigin(src)) {
    errors.push(`${directive} source ${JSON.stringify(src)} is not an exact origin`);
    return errors;
  }
  if (!approved.has(src)) {
    errors.push(`${directive} origin ${JSON.stringify(src)} is not in the approved-endpoint set`);
  }
  return errors;
}

/**
 * Back-compat helper: validate a connect-src source list in isolation.
 * @param {string[]} sources
 * @param {object} opts { approvedEndpoints? }
 * @returns {string[]} violations
 */
export function validateConnectSrc(sources, { approvedEndpoints = [] } = {}) {
  if (!Array.isArray(sources)) {
    return ['connect-src directive is missing or not an array'];
  }
  if (sources.length === 0) {
    return ["connect-src is empty (must pin at least 'self')"];
  }
  const approved = new Set(approvedEndpoints);
  const policy = DIRECTIVE_POLICY['connect-src'];
  const errors = [];
  for (const src of sources) {
    errors.push(...validateSource('connect-src', src, policy, approved));
  }
  return errors;
}

function validateDirectives(directives, approved) {
  const errors = [];

  for (const req of REQUIRED_DIRECTIVES) {
    if (!Array.isArray(directives[req])) {
      errors.push(`required directive "${req}" is missing`);
    }
  }

  for (const [name, sources] of Object.entries(directives)) {
    const policy = DIRECTIVE_POLICY[name];
    if (!policy) {
      errors.push(`unknown directive "${name}" (not on the directive whitelist)`);
      continue;
    }
    if (!Array.isArray(sources)) {
      errors.push(`directive "${name}" must map to an array of sources`);
      continue;
    }
    if (policy.valueless) {
      if (sources.length !== 0) {
        errors.push(`directive "${name}" is valueless but has sources`);
      }
      continue;
    }
    if (sources.length === 0) {
      errors.push(`directive "${name}" has no sources`);
      continue;
    }
    for (const src of sources) {
      errors.push(...validateSource(name, src, policy, approved));
    }
  }
  return errors;
}

function validateAdditionalHeaders(additional, approved) {
  const errors = [];
  if (additional == null) return errors;
  if (typeof additional !== 'object') {
    return ['additional_headers must be an object'];
  }

  for (const [name, value] of Object.entries(additional)) {
    const lower = name.toLowerCase();

    // Name allowlist (fail-closed). Check name BEFORE value so an injected key
    // is rejected even if its value looks benign.
    if (FORBIDDEN_ADDITIONAL_HEADER_NAMES.has(lower)) {
      errors.push(
        `header "${name}" is forbidden in additional_headers — the CSP must ` +
          `come only from "directives" (overriding it re-opens the exfil boundary)`,
      );
      continue;
    }
    if (!ALLOWED_ADDITIONAL_HEADERS.has(lower)) {
      errors.push(`header "${name}" is not on the additional_headers allowlist`);
      continue;
    }

    if (typeof value !== 'string') {
      errors.push(`header "${name}" value must be a string`);
      continue;
    }
    // Header-splitting guard: no CR/LF/control chars in any header value.
    if (HEADER_CTRL_CHARS.test(value)) {
      errors.push(`header "${name}" contains a control char (header-injection vector)`);
      continue;
    }

    if (lower === 'strict-transport-security') {
      const m = /max-age\s*=\s*(\d+)/i.exec(value);
      if (!m) {
        errors.push('Strict-Transport-Security has no max-age');
      } else if (Number(m[1]) < HSTS_MAX_AGE_FLOOR) {
        errors.push(
          `Strict-Transport-Security max-age=${m[1]} is below floor ${HSTS_MAX_AGE_FLOOR} (downgrade)`,
        );
      }
    } else if (lower === 'access-control-allow-origin') {
      // Restrict to the curated approved-origin set. `*` and any fixed
      // attacker origin not on the allowlist are rejected fail-closed.
      const v = value.trim();
      if (v === '*') {
        errors.push('Access-Control-Allow-Origin: * exposes responses cross-origin');
      } else if (!approved.has(v)) {
        errors.push(
          `Access-Control-Allow-Origin ${JSON.stringify(v)} is not in the approved-endpoint set`,
        );
      }
    } else if (lower === 'x-content-type-options') {
      if (value.trim().toLowerCase() !== 'nosniff') {
        errors.push(`X-Content-Type-Options must be "nosniff", got ${JSON.stringify(value)}`);
      }
    } else if (lower === 'x-frame-options') {
      if (!['DENY', 'SAMEORIGIN'].includes(value.trim().toUpperCase())) {
        errors.push(`X-Frame-Options must be DENY or SAMEORIGIN, got ${JSON.stringify(value)}`);
      }
    } else if (lower === 'cross-origin-opener-policy') {
      if (!['same-origin', 'same-origin-allow-popups'].includes(value.trim().toLowerCase())) {
        errors.push(`Cross-Origin-Opener-Policy weakened: ${JSON.stringify(value)}`);
      }
    } else if (lower === 'cross-origin-embedder-policy') {
      if (!['require-corp', 'credentialless'].includes(value.trim().toLowerCase())) {
        errors.push(`Cross-Origin-Embedder-Policy weakened: ${JSON.stringify(value)}`);
      }
    } else if (lower === 'cross-origin-resource-policy') {
      if (!['same-origin', 'same-site'].includes(value.trim().toLowerCase())) {
        errors.push(`Cross-Origin-Resource-Policy weakened: ${JSON.stringify(value)}`);
      }
    } else if (lower === 'permissions-policy') {
      if (value.includes('*')) {
        errors.push('Permissions-Policy grants a wildcard allowlist (*)');
      }
    }
  }
  return errors;
}

/**
 * Full validation of a baseline against the M1B enforcement rules — every
 * directive AND every additional header, plus a post-serialization structural
 * check that no directive is emitted twice (defence in depth vs. injection).
 * @param {object} baseline parsed csp-baseline.json
 * @param {object} [opts] { approvedEndpoints? }
 * @returns {string[]} violations (empty = clean)
 */
export function validateBaseline(baseline, { approvedEndpoints = [] } = {}) {
  const directives = baseline?.directives;
  if (!directives || typeof directives !== 'object') {
    return ['baseline is missing a "directives" object'];
  }
  const approved = new Set(approvedEndpoints);
  const errors = [
    ...validateDirectives(directives, approved),
    ...validateAdditionalHeaders(baseline.additional_headers, approved),
  ];

  // Structural defence in depth: the serialized policy must not contain a
  // duplicate directive name (CSP "first policy wins" would let a duplicate
  // silently override an earlier, stricter one).
  if (errors.length === 0) {
    const emitted = serializeCsp(directives)
      .split(';')
      .map((d) => d.trim().split(/\s+/)[0])
      .filter(Boolean);
    const seen = new Set();
    for (const name of emitted) {
      if (seen.has(name)) errors.push(`duplicate directive "${name}" in serialized policy`);
      seen.add(name);
    }
  }
  return errors;
}

/**
 * Serialize a directive map into a Content-Security-Policy header string.
 * Rejects any source token carrying an injection char (defence in depth: the
 * serializer itself refuses to emit an unsafe policy).
 * @param {Record<string, string[]>} directives
 * @returns {string} CSP header value
 */
export function serializeCsp(directives) {
  if (!directives || typeof directives !== 'object') {
    throw new CspValidationError(['serializeCsp: directives must be an object']);
  }
  const parts = [];
  for (const [name, sources] of Object.entries(directives)) {
    // Validate the directive NAME (defence in depth): a name carrying a
    // separator/control char injects an extra directive, and an unknown name
    // is not part of the reviewed policy surface. Both are refused fail-closed
    // so the serializer itself can never emit an unsafe policy.
    if (ILLEGAL_SOURCE_CHARS.test(name)) {
      throw new CspValidationError([
        `directive name ${JSON.stringify(name)} contains an illegal separator/control char (injection vector)`,
      ]);
    }
    if (!KNOWN_DIRECTIVE_NAMES.has(name)) {
      throw new CspValidationError([
        `directive name ${JSON.stringify(name)} is not on the directive whitelist`,
      ]);
    }
    if (!Array.isArray(sources)) {
      throw new CspValidationError([`directive "${name}" must map to an array of sources`]);
    }
    for (const src of sources) {
      if (typeof src !== 'string' || ILLEGAL_SOURCE_CHARS.test(src)) {
        throw new CspValidationError([
          `directive "${name}" has an unserializable source ${JSON.stringify(src)}`,
        ]);
      }
    }
    if (VALUELESS_DIRECTIVES.has(name) || sources.length === 0) {
      parts.push(name);
    } else {
      parts.push(`${name} ${sources.join(' ')}`);
    }
  }
  return parts.join('; ');
}

/**
 * Build the complete served header map (CSP + all additional headers) from the
 * baseline, after validating it. Throws CspValidationError on any violation so
 * a broken policy can never be served.
 * @param {object} baseline parsed csp-baseline.json
 * @param {object} [opts] { approvedEndpoints? }
 * @returns {Record<string,string>} header name -> value
 */
export function buildHeaderMap(baseline, { approvedEndpoints = [] } = {}) {
  const errors = validateBaseline(baseline, { approvedEndpoints });
  if (errors.length > 0) {
    throw new CspValidationError(errors);
  }
  const headers = {
    'Content-Security-Policy': serializeCsp(baseline.directives),
  };
  // Defence in depth: even though validation already rejects a CSP-defining or
  // colliding additional-header key, never let additional_headers overwrite an
  // already-set header (case-insensitive) — the served CSP comes ONLY from
  // `directives`, and no attacker key can shadow it on the wire.
  const seen = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  const additional = baseline.additional_headers || {};
  for (const [name, value] of Object.entries(additional)) {
    const lower = name.toLowerCase();
    if (FORBIDDEN_ADDITIONAL_HEADER_NAMES.has(lower) || seen.has(lower)) {
      continue; // unreachable after validation; belt-and-suspenders on the wire
    }
    headers[name] = value;
    seen.add(lower);
  }
  return headers;
}

/**
 * Apply a header map to a Node http.ServerResponse (or any object with
 * setHeader). Used by the serving path and the integration test.
 * @param {{setHeader: (k:string,v:string)=>void}} res
 * @param {Record<string,string>} headerMap
 */
export function applySecurityHeaders(res, headerMap) {
  for (const [name, value] of Object.entries(headerMap)) {
    res.setHeader(name, value);
  }
}
