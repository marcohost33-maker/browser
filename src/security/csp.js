// APP-01 CSP + security-header serializer (M1B).
//
// Single source of truth: docs/security/csp-baseline.json. This module turns
// that machine-readable baseline into the exact header strings the app serves,
// and enforces the connect-src exfiltration boundary at build/CI time.
//
// No runtime dependencies (Node built-ins only) — the repo keeps the bundle
// dependency-free (see .github/workflows/docs-ci.yml rationale).
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
 * Serialize a directive map into a Content-Security-Policy header string.
 * @param {Record<string, string[]>} directives
 * @returns {string} CSP header value
 */
export function serializeCsp(directives) {
  if (!directives || typeof directives !== 'object') {
    throw new CspValidationError(['serializeCsp: directives must be an object']);
  }
  const parts = [];
  for (const [name, sources] of Object.entries(directives)) {
    if (!Array.isArray(sources)) {
      throw new CspValidationError([
        `directive "${name}" must map to an array of sources`,
      ]);
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
  // origin must round-trip exactly: rejects trailing paths/queries and
  // scheme-only shorthands (new URL('https:') throws or has null host).
  if (!url.host) return false;
  return url.origin === src && url.origin !== 'null';
}

/**
 * Validate connect-src against the exfiltration-boundary policy.
 * Only `'self'` plus exact origins present in the approved-endpoint set are
 * allowed; wildcards, scheme-sources and forbidden tokens are rejected.
 * @param {string[]} sources connect-src source list
 * @param {object} opts
 * @param {string[]} [opts.approvedEndpoints] curated exact-origin allowlist
 * @param {string[]} opts.forbiddenTokens forbidden token list from baseline
 * @returns {string[]} list of human-readable violations (empty = clean)
 */
export function validateConnectSrc(sources, { approvedEndpoints = [], forbiddenTokens }) {
  const errors = [];
  if (!Array.isArray(sources)) {
    return ['connect-src directive is missing or not an array'];
  }
  if (sources.length === 0) {
    return ['connect-src is empty (must pin at least \'self\')'];
  }
  const approved = new Set(approvedEndpoints);
  for (const src of sources) {
    if (src === "'self'") continue;
    if (Array.isArray(forbiddenTokens) && forbiddenTokens.includes(src)) {
      errors.push(`connect-src contains forbidden token "${src}"`);
      continue;
    }
    if (src === '*') {
      errors.push('connect-src contains wildcard "*"');
      continue;
    }
    // scheme-only source (https:, http:, data:, blob:, ws:, wss: ...)
    if (/^[a-z][a-z0-9+.-]*:$/i.test(src)) {
      errors.push(`connect-src contains scheme-source "${src}" (widens exfil surface)`);
      continue;
    }
    if (src.includes('*')) {
      errors.push(`connect-src contains wildcard host "${src}"`);
      continue;
    }
    if (!isExactOrigin(src)) {
      errors.push(`connect-src source "${src}" is not an exact origin`);
      continue;
    }
    if (!approved.has(src)) {
      errors.push(`connect-src origin "${src}" is not in the approved-endpoint set`);
    }
  }
  return errors;
}

// Tokens that must never appear in script-src (DOM-XSS escape hatches).
const FORBIDDEN_SCRIPT_SRC = new Set(["'unsafe-inline'", "'unsafe-eval'", '*']);

/**
 * Full validation of a baseline against the M1B enforcement rules.
 * @param {object} baseline parsed csp-baseline.json
 * @param {object} [opts]
 * @param {string[]} [opts.approvedEndpoints] curated exact-origin allowlist
 * @returns {string[]} violations (empty = clean)
 */
export function validateBaseline(baseline, { approvedEndpoints = [] } = {}) {
  const errors = [];
  const directives = baseline?.directives;
  if (!directives || typeof directives !== 'object') {
    return ['baseline is missing a "directives" object'];
  }

  for (const req of REQUIRED_DIRECTIVES) {
    if (!Array.isArray(directives[req])) {
      errors.push(`required directive "${req}" is missing`);
    }
  }

  const forbiddenTokens = baseline?.connect_src_policy?.forbidden_tokens;

  if (Array.isArray(directives['connect-src'])) {
    errors.push(
      ...validateConnectSrc(directives['connect-src'], {
        approvedEndpoints,
        forbiddenTokens,
      }),
    );
  }

  if (Array.isArray(directives['script-src'])) {
    for (const src of directives['script-src']) {
      if (FORBIDDEN_SCRIPT_SRC.has(src)) {
        errors.push(`script-src contains forbidden token "${src}"`);
      }
      if (/^https?:$/i.test(src)) {
        errors.push(`script-src contains scheme-source "${src}"`);
      }
    }
  }

  return errors;
}

/**
 * Build the complete served header map (CSP + all additional headers) from the
 * baseline, after validating it. Throws CspValidationError on any violation so
 * a broken policy can never be served.
 * @param {object} baseline parsed csp-baseline.json
 * @param {object} [opts]
 * @param {string[]} [opts.approvedEndpoints] curated exact-origin allowlist
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
  const additional = baseline.additional_headers || {};
  for (const [name, value] of Object.entries(additional)) {
    headers[name] = value;
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
