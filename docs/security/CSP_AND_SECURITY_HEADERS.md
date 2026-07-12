# APP-01 CSP and Security-Header Profile — M1

- Status: ENFORCED STATIC FOUNDATION / RUNTIME AND EDGE EVIDENCE OPEN
- Updated: 2026-07-12
- Scope: APP-01 `browser`
- Runtime endpoint synchronization: blocked on ADR-003 and the MCP client
- Emitted-value source: [`csp-baseline.json`](./csp-baseline.json)

## Security objective and maturity boundary

The M1 foundation minimizes document, script, resource, permission and network
surfaces before application runtime exists. The committed baseline is validated
fail closed, serialized, tested through a Node response boundary and checked in
CI.

This is **not** proof of deployed enforcement or production readiness. A CDN,
reverse proxy, application middleware, service worker or hosting platform can
still remove, combine or replace headers after the in-process check. Staging and
production responses therefore require independent browser/edge evidence.

CSP and browser headers are defense in depth. They do not replace runtime schema
validation, safe rendering, authorization, dependency integrity, SSRF controls,
privacy tests or correct server-side policy.

## Policy data versus policy contract

There is one source of **emitted values**:
`docs/security/csp-baseline.json`. No application or deployment file may maintain
another CSP string.

`src/security/header-values.js` is deliberately independent contract code, not a
second emitted policy. It encodes the reviewed M1 invariants so a data-only edit
cannot silently widen the baseline. A legitimate policy change must update, in
one reviewed change:

1. the machine-readable baseline;
2. the independent contract;
3. positive and negative tests;
4. this rationale and the applicable ADR/risk record.

Application code uses `buildHardenedHeaderMap()` or
`applyHardenedSecurityHeaders()`, never the low-level serializer directly.

## Network boundary

`connect-src` is the browser-side exfiltration backstop. The baseline is
`'self'` only. A deployment may append only canonical origins from a reviewed
set.

The M1 static gate rejects:

- wildcards and scheme-wide sources;
- paths, queries, fragments, user information and trailing-dot hostnames;
- remote plaintext HTTP;
- private or link-local IP literals, including metadata-service ranges;
- duplicates and origins not present in the deployment approval set;
- runtime widening from user input.

Plain HTTP is restricted to explicit `localhost`, `127.0.0.1` and `::1`
development origins. The full MCP endpoint URL, redirects, DNS resolution,
private-network transitions, CORS and authorization remain separate ADR-003
runtime obligations. Static string validation cannot prevent DNS rebinding.

## Static-SPA constraint

A CSP delivered with the document cannot be loosened by application code. M1
therefore permits only:

1. a same-origin gateway with `connect-src 'self'`;
2. a curated origin set compiled into deployment policy;
3. per-deployment generation from the validated baseline.

Supporting arbitrary remote origins by changing the policy to `https:` or `*`
is prohibited.

## Enforced header profile

| Header | M1 value or rule |
|---|---|
| `Content-Security-Policy` | Generated from `directives` only; exact M1 contract |
| `Strict-Transport-Security` | `max-age` at least one year and `includeSubDomains`; `preload` blocked pending operations approval |
| `X-Content-Type-Options` | Exactly `nosniff` |
| `Referrer-Policy` | Canonical safe allowlist; baseline `no-referrer` |
| `Permissions-Policy` | Reviewed powerful-feature deny set, each exactly `()` |
| `Cross-Origin-Opener-Policy` | Exactly `same-origin` |
| `Cross-Origin-Embedder-Policy` | Exactly `require-corp` |
| `Cross-Origin-Resource-Policy` | Exactly `same-origin` |
| `X-Frame-Options` | Exactly `DENY` |

`Access-Control-Allow-Origin` is deliberately absent and forbidden in this app
response profile. Outbound MCP target origins and inbound application-response
CORS permissions are opposite trust directions. MCP endpoint CORS belongs to
the server compatibility profile in ADR-003.

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

## Permissions-Policy limitation

The header disables a curated set of powerful features, including capture,
credentials, hardware, local-network, storage-access and XR surfaces. The
validator requires exact lowercase feature names, exactly one declaration per
feature, no unreviewed extras and an empty allowlist `()`.

This is not a universal browser capability sandbox. Permissions Policy has
uneven and evolving browser support; unsupported directives may be ignored.
ADR-004 must therefore verify behavior in every supported browser, and runtime
code must not request or depend on capabilities outside the accepted product
scope.

## HSTS and preload

M1 sends a long `max-age` with `includeSubDomains`. This affects every HTTPS
subdomain once cached and therefore still requires domain inventory and rollback
planning.

The `preload` token is intentionally rejected. Browser preload lists are an
external, long-lived operational commitment and removal is not immediate. It may
only be introduced after an explicit deployment ADR confirms all subdomains,
redirect behavior, ownership, removal procedure and rollback constraints.

## COOP and COEP compatibility

`COOP: same-origin` and `COEP: require-corp` establish a strong isolation target,
but they can break OAuth popup communication and third-party/cross-origin
resources that do not opt in correctly. Their presence is a static target, not a
compatibility claim. ADR-003/ADR-004 must test the selected authorization flow,
resource graph and supported browsers before release.

## Fail-closed validation

The implementation rejects:

- missing, reordered or drifted M1 CSP directives;
- unknown directives, non-array values, unsafe tokens and injection characters;
- CSP and Report-Only overrides in `additional_headers`;
- missing, duplicate, unexpected or weakened security headers;
- malformed or weak HSTS and premature `preload`;
- weak/noncanonical Referrer-Policy values;
- malformed, mixed-case, duplicate, missing, granted or unreviewed
  Permissions-Policy features;
- invalid, duplicate, noncanonical, plaintext-remote or private-IP origins;
- a final response map with missing, changed or duplicate protected headers.

A failing baseline cannot be serialized or served through the hardened entry
point.

## Final response and deployed-edge verification

`applyHardenedSecurityHeaders()` applies the map and immediately verifies
`getHeaders()` on the response object. `validateServedHeaderMap()` can validate a
captured final in-process map and permits unrelated operational headers while
requiring every protected value exactly.

These checks cannot detect mutations after they run. Release evidence must also
capture the actual staging and production response after all middleware, proxy,
CDN and hosting transformations, then verify browser-observed policy behavior.

## Deterministic verification

```bash
npm run toolchain:check
npm run lockfile:check
npm ci --ignore-scripts --audit=false --fund=false
npm run audit:ci
npm run csp:check
npm test
npm run csp:json
```

The CI runtime, npm version and documentation tools are exact-version locked.
The evidence manifest records source SHA, tested SHA, Node/npm versions and
hashes of `package.json`, `package-lock.json` and the SPDX SBOM.

## Runtime requirements after ADR-003

The future application must verify that:

- each selectable endpoint maps to an origin present in the served CSP;
- unapproved selections fail visibly without policy widening;
- CORS, redirects, DNS resolution and authorization match the endpoint profile;
- token passthrough is prohibited and OAuth audience/issuer/state/PKCE controls
  are verified where OAuth is used;
- timeout, abort, byte/depth/item limits and reconnect semantics are deterministic;
- browser E2E proves unapproved exfiltration is blocked;
- hostile MCP text, Markdown and URLs render without code/instruction execution;
- sensitive canaries do not reach storage, URL, history, DOM, logs or diagnostics.

## Primary sources

- CSP Level 3: `https://www.w3.org/TR/CSP3/`
- MDN Content-Security-Policy:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy`
- W3C Permissions Policy Editor's Draft:
  `https://w3c.github.io/webappsec-permissions-policy/`
- MDN Permissions-Policy:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy`
- MDN HSTS:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security`
- MDN COOP and COEP:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy`
  and
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy`
- MCP security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
