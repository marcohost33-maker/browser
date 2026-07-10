# APP-01 CSP and Security-Header Profile — M1

- Status: GOOD-DRAFT (specification). Build/CI enforcement landed in M1B (#10):
  serializer + `connect-src` negative test + header-served integration test,
  wired as the `security-ci` gate. **Runtime-blocked residue** (see #11 / M1C):
  the dynamic per-endpoint `connect-src` injection and the UI↔policy sync depend
  on the not-yet-existing MCP client runtime and are intentionally out of scope
  here — the static/baseline-driven boundary is enforced now.
- Date: 2026-07-10
- Applies to: public MCP-client webapp (APP-01)
- Machine-readable baseline: [`csp-baseline.json`](./csp-baseline.json)

## Why `connect-src` is the crown-jewel control here

APP-01 handles prompts, resources, tool arguments and results, plus
authorization material. The single highest-value exfiltration control for a
browser MCP client is the CSP `connect-src` directive: it governs every
outbound request channel a script can use — `fetch()`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, `<a ping>`, and `navigator.sendBeacon()`
([content-security-policy.com/connect-src](https://content-security-policy.com/connect-src/),
confidence: high; corroborated by
[MDN CSP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)).

Consequence: even if an attacker achieves script execution (XSS, or injected
instructions rendered from untrusted MCP content), a correctly pinned
`connect-src` prevents that script from shipping stolen credentials or content
to an attacker-controlled origin. It is the enforcement backstop behind the
ASI02 endpoint allowlist and the SSRF controls in the threat model.

## Core rule: `connect-src` is pinned to the approved-endpoint set

`connect-src` MUST enumerate exactly the origins APP-01 is permitted to reach:
`'self'` plus the specific, approved MCP endpoint origin(s). It MUST NOT use
`*`, `https:`, `data:`, `blob:` or any scheme-wildcard. An explicit
per-origin allowlist — not a permissive pattern — is what makes the directive
an exfiltration boundary
([OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html),
confidence: high).

### The static-SPA tension (stated honestly)

A CSP delivered with the document cannot be *loosened* at runtime: additional
policies only ever intersect (tighten), never widen
([MDN CSP: multiple policies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy),
confidence: high). A purely static SPA therefore cannot inject a
user-typed endpoint origin into its own served `connect-src` after load.
Three admissible resolutions, in order of preference:

1. **Same-origin proxy** — all MCP traffic flows through a same-origin
   backend; `connect-src` stays `'self'`. (Out of M1 scope: ADR-001 defers
   server-side proxying; listed here as the strongest long-term option.)
2. **Curated allowlist compiled into the deployed policy** — a vetted set of
   MCP endpoint origins is baked into the served CSP at build/deploy time
   (see the ASI02 allowlist mechanic in the threat model). User selection is
   restricted to this set.
3. **Per-deployment policy generation** — the operator regenerates the CSP
   for their own endpoint set at deploy time from `csp-baseline.json`.

Forbidden non-resolution: widening `connect-src` to `https:` or `*` to
"support any endpoint". That converts the crown-jewel control into a no-op.

### Fail-closed coupling with the UI

The served `connect-src` allowlist is the single source of truth. If a user
approves an endpoint in the UI whose origin is **not** in the served policy,
the connection MUST fail closed with a visible error — never a silent widening
of the exfiltration surface. UI approval state and CSP allowlist are kept in
sync by construction, not by hope.

## Full baseline header set (M1, before any endpoint is approved)

The baseline below assumes a same-origin-only application shell with no
approved remote MCP endpoint yet. Approving an endpoint adds *only* that
origin to `connect-src` (via one of the three resolutions above).

| Header | Baseline value | Purpose |
|---|---|---|
| `Content-Security-Policy` | see `csp-baseline.json` | XSS + exfiltration boundary |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HTTPS pinning |
| `X-Content-Type-Options` | `nosniff` | MIME-sniffing defense |
| `Referrer-Policy` | `no-referrer` | prevent endpoint/URL leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | disable unused powerful features |
| `Cross-Origin-Opener-Policy` | `same-origin` | process isolation |
| `Cross-Origin-Embedder-Policy` | `require-corp` | isolation / Spectre defense |
| `Cross-Origin-Resource-Policy` | `same-origin` | limit cross-origin embedding |
| `X-Frame-Options` | `DENY` | clickjacking (legacy backstop to `frame-ancestors`) |

The CSP itself (baseline) is:

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

Notes:

- No `unsafe-eval`, no `unsafe-inline` (ADR-001 release blocker). Any inline
  need uses a per-response nonce, not `unsafe-inline`.
- `require-trusted-types-for 'script'` hardens DOM-XSS sinks — appropriate
  because APP-01 renders untrusted MCP result content.
- `connect-src 'self'` is the baseline; **only** an approved endpoint origin
  is appended, and nothing else.

## Executable artifact

`csp-baseline.json` is a machine-readable directive→sources map. A build/CI
step (M1B) will serialize it into the header string above and a test will
assert: (a) no forbidden token (`*`, `https:`, `http:`, `unsafe-eval`,
`unsafe-inline`) appears in `connect-src`/`script-src`; (b) `connect-src`
contains only `'self'` plus origins present in the approved-endpoint set. That
test is the executable form of the rules in this document.

**Enforced (M1B, #10):**

- Serializer: [`src/security/csp.js`](../../src/security/csp.js) emits the served
  header set from `csp-baseline.json` (single source of truth — no second CSP
  definition). CLI: `node src/security/serialize-cli.js [--json|--check]`.
- `connect-src` negative test + header-served integration test:
  [`tests/security/`](../../tests/security/) (`npm test`, zero deps —
  Node's built-in `node --test`).
- CI gate: [`.github/workflows/security-ci.yml`](../../.github/workflows/security-ci.yml)
  runs the `connect-src` gate (`--check`) and the tests on every push/PR.

## Verification plan (M1B/M1D)

- Integration test asserts the exact header set is served (ADR-001 quality
  gate).
- Negative test: a baseline that would emit an unsafe served policy fails the
  build (silent-failure gate). The check is **validate-then-serialize over the
  whole served surface** — every directive and every additional header — not
  just the `connect-src` array. Concretely it rejects: forbidden tokens /
  wildcards / scheme-sources / non-allowlisted origins in any fetch or
  navigation directive (`connect-src`, `script-src`, `img-src`, `form-action`,
  `base-uri`, …); `;`/whitespace/control-char **injection** in any source token
  (which would otherwise smuggle an extra widening directive into the emitted
  string); unknown directive names; duplicate directives; and weakened or
  unexpected `additional_headers`. `additional_headers` is restricted to a
  **name allowlist**: a `Content-Security-Policy` /
  `Content-Security-Policy-Report-Only` key (any case) is rejected — the served
  CSP comes **only** from `directives` and cannot be overridden or shadowed via
  an additional header. Value checks: HSTS below a 1-year floor,
  `Access-Control-Allow-Origin` outside the approved-origin set, weakened
  COOP/COEP/CORP/XFO, and CRLF/control chars in a header value all fail. This
  closes the Aegis PoCs (2026-07-10 `;`-injection in `default-src` + HSTS
  `max-age=0`; 2026-07-11 `additional_headers` CSP-override) that passed
  earlier, narrower checks.
- E2E: with only `'self'` in `connect-src`, an attempt to `fetch()` an
  un-approved origin is blocked by the browser and surfaced as a normalized
  error.

## Sources

- CSP `connect-src` semantics — <https://content-security-policy.com/connect-src/> (high)
- MDN Content-Security-Policy reference — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy> (high)
- OWASP CSP Cheat Sheet — <https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html> (high)
- Deploying CSP in SPAs (Auth0) — <https://auth0.com/blog/deploying-csp-in-spa/> (medium)
- MCP Security Best Practices (recommends CSP for web MCP clients) — <https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices> (high)
