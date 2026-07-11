# APP-01 CSP and Security-Header Profile — M1

- Status: ENFORCED STATIC BASELINE
- Updated: 2026-07-11
- Scope: APP-01 `browser`
- Runtime endpoint synchronization: blocked on ADR-003 and the MCP client
- Machine-readable source: [`csp-baseline.json`](./csp-baseline.json)

## Security objective

The M1 browser shell permits only the minimum document, script, style, resource
and network surfaces needed by the current application foundation. Security
headers are generated from one machine-readable baseline, validated fail closed
and verified on a real HTTP response.

CSP is defense in depth. It does not replace input validation, safe rendering,
authorization, dependency integrity or correct server-side controls.

## Network boundary

`connect-src` is the browser-side exfiltration backstop. The baseline is
`'self'` only. A deployment may add only canonical exact origins from the
reviewed approved-origin set.

Forbidden shortcuts include:

- `*`;
- `https:` or `http:` scheme sources;
- wildcard hosts;
- origins with paths, query strings, fragments or userinfo;
- unreviewed remote HTTP;
- runtime widening from user input.

Production remote origins require HTTPS. Plain HTTP is restricted to explicit
`localhost`, `127.0.0.1` or `::1` development origins.

The full MCP endpoint URL may contain a path. It is validated separately from
the CSP origin under ADR-003.

## Static-SPA constraint

A CSP delivered with the document cannot be loosened by application code. M1
therefore allows only:

1. a same-origin gateway with `connect-src 'self'`;
2. a curated endpoint-origin set compiled into deployment policy;
3. per-deployment policy generation from the validated baseline.

Supporting arbitrary remote origins by changing the policy to `https:` or `*`
is prohibited.

## Enforced baseline

| Header | M1 value/policy |
|---|---|
| `Content-Security-Policy` | generated from `directives` only |
| `Strict-Transport-Security` | valid `max-age` ≥ 31536000, `includeSubDomains`, optional `preload` |
| `X-Content-Type-Options` | exactly `nosniff` |
| `Referrer-Policy` | canonical safe allowlist; baseline `no-referrer` |
| `Permissions-Policy` | required powerful features explicitly disabled with `()` |
| `Cross-Origin-Opener-Policy` | exactly `same-origin` |
| `Cross-Origin-Embedder-Policy` | exactly `require-corp` |
| `Cross-Origin-Resource-Policy` | exactly `same-origin` |
| `X-Frame-Options` | exactly `DENY` |

The baseline CSP is:

```text
default-src 'none';
base-uri 'none';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
img-src 'self' data:;
style-src 'self';
font-src 'self';
script-src 'self';
connect-src 'self';
manifest-src 'self';
worker-src 'self';
require-trusted-types-for 'script';
upgrade-insecure-requests
```

## Fail-closed validation

The implementation rejects:

- missing required directives or security headers;
- unknown CSP directives or non-array directive values;
- wildcards, unsafe keywords and unapproved schemes/origins;
- separator, whitespace and control-character injection in source tokens;
- duplicate serialized CSP directives;
- CSP or Report-Only overrides in `additional_headers`;
- case-insensitive duplicate header names;
- header-name or value injection;
- malformed, duplicate, unknown or weak HSTS directives;
- noncanonical or weak Referrer-Policy values;
- mixed-case, malformed, duplicate, missing or granted Permissions-Policy
  features;
- downgraded MIME, opener, embedder, resource or framing policies;
- invalid, duplicate, noncanonical or insecure deployment origins.

A baseline that fails validation cannot be serialized or served.

## Single source of truth

- `docs/security/csp-baseline.json` contains policy data.
- `src/security/csp.js` validates CSP structure and serializes the policy.
- `src/security/header-values.js` validates the complete M1 header and approved
  origin policy.
- `src/security/serialize-cli.js` is the CI/deployment gate.
- `tests/security/` contains positive, negative and real-response tests.

No deployment template or application server may maintain a second independent
CSP string.

## Commands

```bash
npm ci --ignore-scripts
npm run csp:check
npm test
npm run csp:json
```

`CSP_APPROVED_ENDPOINTS` currently accepts a comma-separated list of **origins**,
not endpoint URLs. Before runtime integration it will be renamed to
`CSP_APPROVED_ORIGINS`; a compatibility alias must reject ambiguous dual
configuration.

## Runtime requirements after ADR-003

The static baseline does not yet prove runtime synchronization. The future
application must verify that:

- every selectable endpoint maps to an origin already present in served CSP;
- unapproved selections fail visibly without policy widening;
- CORS and authorization match the endpoint profile;
- redirects cannot escape the approved endpoint/origin policy;
- browser E2E confirms an unapproved exfiltration request is blocked;
- sensitive canaries do not reach storage, URL, DOM, logs or diagnostics.

## Deployment cautions

- HSTS has effect only over HTTPS and can affect all subdomains when
  `includeSubDomains` is used.
- `preload` is an operational commitment; registration/removal and subdomain
  readiness must be handled deliberately.
- COEP `require-corp` may block third-party assets; M1 intentionally avoids
  unnecessary remote assets.
- Trusted Types enforcement requires application code and dependencies to avoid
  unsafe DOM sinks; its presence is not evidence that rendering is safe.
- Browser support and behavior must be verified against the ADR-004 matrix.

## Primary sources

- CSP Level 3:
  `https://www.w3.org/TR/CSP3/`
- MDN Content-Security-Policy:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy`
- W3C Permissions Policy Editor's Draft:
  `https://w3c.github.io/webappsec-permissions-policy/`
- MDN Permissions-Policy:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy`
- OWASP HTTP Headers Cheat Sheet:
  `https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html`
- MCP security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
