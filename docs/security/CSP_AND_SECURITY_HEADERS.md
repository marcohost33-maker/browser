# APP-01 CSP and Security-Header Profile — M1

- Status: ENFORCED STATIC FOUNDATION / RUNTIME AND EDGE EVIDENCE OPEN
- Updated: 2026-07-12
- Scope: `browser`
- Runtime egress synchronization: the exact-origin allowlist applies to any
  approved network egress target (remote endpoint or a locally hosted app's egress);
  runtime binding follows the reframed runtime design (ADR-005/006/007, PR #22 —
  ADR-003 superseded)
- Emitted-value source: [`csp-baseline.json`](./csp-baseline.json)

## Security objective and maturity boundary

The M1 foundation constrains document, script, resource, permission and network
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

The validator also checks the baseline's top-level metadata and
`connect_src_policy` object. Unknown keys, malformed versions/dates or drifted
policy metadata fail closed instead of becoming unaudited prose beside the real
controls.

Application code uses `buildHardenedHeaderMap()` or
`applyHardenedSecurityHeaders()`, never the low-level serializer or map builder
directly. A source-level regression gate rejects future imports of the raw
primitives outside the security implementation and CLI.

## Network boundary

`connect-src` is the browser-side exfiltration backstop. The baseline is
`'self'` only. A deployment may append only canonical origins from a reviewed
set.

The M1 static gate rejects:

- wildcards and scheme-wide sources;
- paths, queries, fragments, user information and trailing-dot hostnames;
- remote plaintext HTTP;
- non-public/reserved IPv4, IPv6 and IPv4-mapped IPv6 literals;
- localhost names outside the explicit development profile;
- alternative noncanonical numeric IP spellings;
- duplicates and origins not present in the deployment approval set;
- runtime widening from user input.

Plain HTTP is restricted to explicit `localhost`, `127.0.0.1` and `::1`
development origins. The full MCP endpoint URL, redirects, DNS resolution,
private-network transitions, CORS and authorization remain separate ADR-003
runtime obligations. Static string validation cannot prevent DNS rebinding or a
public hostname resolving to a private address.

## Static-SPA constraint

A CSP delivered with the document cannot be loosened by application code. M1
therefore permits only:

1. a same-origin gateway with `connect-src 'self'`;
2. a curated origin set compiled into deployment policy;
3. per-deployment generation from the validated baseline.

Supporting arbitrary remote origins by changing the policy to `https:` or `*`
is prohibited.

## Provisional capability budget

The current pre-runtime baseline still provisionally allows several same-origin
surfaces: form submission, `data:` images, fonts, a web-app manifest and workers.
Their presence is **not** evidence that the product needs them and must not be
copied into a release unchanged by default.

ADR-004 must evaluate each capability separately and apply a
**remove-unless-proven** rule:

| Capability | Current token | Required evidence before release |
|---|---|---|
| Forms | `form-action 'self'` | The chosen top task requires native form navigation rather than controlled `fetch` |
| Inline image data | `img-src 'self' data:` | Measured asset need and hostile SVG/data-URL tests |
| Fonts | `font-src 'self'` | Self-hosted font requirement, licensing and performance evidence |
| Manifest | `manifest-src 'self'` | Explicit installability/PWA product decision |
| Workers/service workers | `worker-src 'self'` | Explicit worker/PWA decision, cache/update/rollback and offline-threat analysis |

If evidence is absent, the directive must be changed to `'none'` or the source
removed before the first application release. Service workers receive particular
scrutiny because they can persist beyond a page load and mediate later requests.

## Enforced header profile

| Header | M1 value or rule |
|---|---|
| `Content-Security-Policy` | Generated from `directives` only; exact M1 contract |
| `Strict-Transport-Security` | Exactly `max-age=63072000; includeSubDomains`; `preload` forbidden |
| `Integrity-Policy` | Exactly `blocked-destinations=(script style)`; report-only twin forbidden |
| `X-Content-Type-Options` | Exactly `nosniff` |
| `Referrer-Policy` | Exactly `no-referrer` |
| `Permissions-Policy` | Exact reviewed feature set, canonical order, each value `()` |
| `Cross-Origin-Opener-Policy` | Exactly `same-origin` |
| `Cross-Origin-Embedder-Policy` | Exactly `require-corp` |
| `Cross-Origin-Resource-Policy` | Exactly `same-origin` |
| `X-Frame-Options` | Exactly `DENY` |

The exact Privacy and HSTS values are contract values, not merely lower bounds.
For example, changing `no-referrer` to `strict-origin-when-cross-origin`, or
reducing HSTS from two years to one year, now requires a reviewed policy change
rather than passing as "still reasonably safe".

## Forbidden final-response headers

The final in-process response gate rejects additional headers that reverse M1
trust directions, create state, emit sensitive browser reports or expose
implementation details. This includes:

- every `Access-Control-*` response header;
- `Content-Security-Policy-Report-Only`;
- `Report-To`, `Reporting-Endpoints` and `NEL`;
- `Timing-Allow-Origin`;
- `Set-Cookie` and `Set-Cookie2`;
- `Server` and `X-Powered-By`.

CSP and network-error reports can contain request and violation context and cause
the browser to transmit data to configured reporting endpoints. Reporting is
therefore a separate, privacy-reviewed operational feature, not an arbitrary
extra header. Likewise, outbound MCP target origins and inbound application
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
trusted-types 'none';
upgrade-insecure-requests
```

## Trusted Types (DOM-XSS sink hardening)

`require-trusted-types-for 'script'` makes injection sinks (`innerHTML`,
`document.write`, `eval`, `script.src`, …) reject raw strings — they only accept
non-spoofable values minted by a Trusted Types policy. On its own that directive
leaves policy *creation* unrestricted, so a compromised script could call
`trustedTypes.createPolicy('anything', …)` and mint its own pass-through values,
weakening the guarantee.

The baseline therefore pairs it with `trusted-types 'none'`, which forbids
creating **any** policy. Together they mean: DOM sinks demand typed values, yet no
code — first- or third-party — can produce one. This is the strictest Trusted
Types configuration and the correct fail-closed default for a repository with no
runtime/script product code yet. When ADR-004 introduces a runtime that must
write to a DOM sink, this relaxes to a *named* policy allowlist
(`trusted-types <policy-name>`) justified by measured evidence — never back to an
unrestricted policy space. Trusted Types is Chromium-only; on Firefox/Safari it is
defence in depth, not a cross-browser guarantee (same caveat as Permissions-Policy
below), and the ADR-004 browser matrix must record that.

## Subresource Integrity enforcement (Integrity-Policy)

`script-src 'self'` answers *which origin may supply a script*. It does not answer
*whether the script that origin supplied is the one we shipped*: `'self'` admits any
same-origin script unconditionally, with no integrity check. An attacker who can
replace a file inside our own origin — a writable storage bucket or CDN path, a
poisoned build artefact, a misconfigured deploy target — therefore executes script
that every other control here considers legitimate. CSP is satisfied; Trusted Types
is satisfied, because the attacker's script simply never routes a raw string into a
DOM sink; and `connect-src` constrains only where a payload may be sent, not whether
hostile code runs.

Classic SRI closes this but is opt-in per element: it protects only the tags that
happen to carry `integrity=`, and it cannot be audited from the response headers.
`Integrity-Policy` inverts that — missing integrity metadata becomes a **load
failure** for the listed destinations.

We block both `script` and `style`. `style-src 'self'` has the identical weakness, and a
swapped stylesheet is not cosmetic: it is a UI-redressing and data-exfiltration
primitive (`background: url(...)` on an attribute selector).

`sources` is omitted deliberately — omitting it is defined as `sources=(inline)`,
which is the wanted behaviour, and spelling it out adds a second value that can
drift. `endpoints` is omitted and `Integrity-Policy-Report-Only` is forbidden: the
report-only twin enforces nothing while emitting violation reports, so it would both
introduce telemetry this repo deliberately does not have and read as "integrity is
handled" in an audit while blocking nothing.

**Support caveat.** `Integrity-Policy` is not Baseline (MDN: limited availability).
Browsers that do not implement it ignore the header, so this is defence in depth
layered on `script-src 'self'`, not a replacement for it. The ADR-004 browser matrix
must record where it is actually in force — the same caveat as `trusted-types`.

Rationale and rejected alternatives: ADR-010.

## Permissions-Policy limitation

The header disables a curated set of powerful features, including capture,
credentials, hardware, local-network, storage-access and XR surfaces. The
validator requires exact lowercase feature names, exactly one declaration per
feature, no unreviewed extras, an empty allowlist `()` and the canonical reviewed
serialization.

This is not a universal browser capability sandbox. Permissions Policy has
uneven and evolving browser support; unsupported directives may be ignored.
ADR-004 must therefore verify behavior in every supported browser, and runtime
code must not request or depend on capabilities outside the accepted product
scope.

## HSTS and preload

M1 sends exactly two years of `max-age` with `includeSubDomains`. This affects
every HTTPS subdomain once cached and therefore still requires domain inventory
and rollback planning.

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
- any non-exact HSTS or Referrer-Policy value and premature `preload`;
- malformed, mixed-case, duplicate, missing, granted, reordered or unreviewed
  Permissions-Policy features;
- invalid, duplicate, noncanonical, plaintext-remote or non-public origins;
- unknown or drifted baseline metadata;
- a final response map with missing, changed or duplicate protected headers;
- security-sensitive reporting, CORS, cookie and implementation-disclosure
  headers added after the baseline map.

A failing baseline cannot be serialized or served through the hardened entry
point.

## Final response and deployed-edge verification

`applyHardenedSecurityHeaders()` applies the map and immediately verifies
`getHeaders()` on the response object. `validateServedHeaderMap()` validates a
captured final in-process map, permits ordinary operational headers and rejects
security-sensitive extras while requiring every protected value exactly.

These checks cannot detect mutations after they run. Release evidence must also
capture the actual staging and production response after all middleware, proxy,
CDN and hosting transformations, then verify browser-observed policy behavior.
Raw wire headers should be retained because high-level header APIs can merge or
normalize duplicate fields.

## Deterministic verification and evidence scope

```bash
npm run toolchain:check
npm run lockfile:check
npm ci --ignore-scripts --audit=false --fund=false
npm run audit:ci
npm run csp:check
npm test
npm run csp:json
```

The Node/npm versions, public npm registry, lifecycle-script policy and
documentation tools are exact-version/configuration checked. GitHub jobs use the
`ubuntu-24.04` runner family instead of the moving `ubuntu-latest` alias.

The security evidence artifact now retains for 90 days:

- the machine-readable npm audit snapshot;
- the SPDX SBOM;
- a manifest binding source SHA and tested merge SHA;
- Node, npm and registry identity;
- runner OS, architecture, image metadata, kernel and Git version;
- hashes of `.npmrc`, `package.json`, `package-lock.json`, audit output and SBOM.

This is strong traceability, not a claim of bit-for-bit reproducibility. GitHub's
hosted runner image, the live advisory database and timestamped SBOM/evidence
fields can change between reruns of the same commit. Reproducible release builds
and independent digest comparison remain separate release gates.

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
- MDN Referrer-Policy:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy`
- MDN COOP and COEP:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy`
  and
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy`
- MCP security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
