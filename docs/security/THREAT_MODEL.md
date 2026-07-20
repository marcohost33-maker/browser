# `browser` Threat Model — M1

- Status: GOOD-DRAFT
- Date: 2026-07-10
- Applies to: `browser` network/egress and rendering security surface

> **Framing note (2026-07-14, revised 2026-07-16).** `browser` is reframed into a
> native, offline-capable runtime (ADR-005/006/007, PR #22). The **M1 core of this
> threat model still applies**: the egress origin allowlist, exact-origin
> `connect-src`, untrusted-content rendering and deny-by-default posture hold
> whether the target is a remote MCP endpoint or the network egress of a locally
> hosted app. Read "MCP endpoint/server" below as "an approved network egress
> target". **But the reframed product is not merely a framing change of the same
> surface.** Hosting *arbitrary foreign web apps* locally is a categorically larger
> attack surface than a single human-in-the-loop MCP client; calling this
> "framing-neutral" understates it. The runtime adds trust-class (T1/T2/T3)
> boundaries and new attacker-reachable sub-surfaces governed by ADR-005/006/007 —
> see "Runtime threat surface" below. The M1 core is retained and valid; the runtime
> surface is genuinely larger and remains **open**.

## Assets

User intent and consent; endpoint configuration; authorization material; MCP session identifiers; capability metadata; prompts, resources and tool results; local preferences; audit evidence; software supply chain.

## Trust boundaries

Browser UI ↔ application state ↔ security-policy layer ↔ MCP adapter ↔ remote ENG-01/MCP endpoint. Browser storage, service workers, third-party dependencies, rendered MCP content and OAuth metadata are separate untrusted boundaries.

## Security invariants

1. Deny by default. A discovered capability is not automatically trusted or enabled.
2. Every operation is bound to visible user intent and an explicit endpoint identity.
3. Tool descriptions, annotations, prompts, resources and result content are untrusted data.
4. Session identifiers are never treated as authentication.
5. Tokens must be audience-bound; token passthrough is forbidden.
6. Production OAuth and MCP metadata URLs require HTTPS and validated redirects.
7. Sensitive values are memory-only unless a later reviewed design explicitly permits secure persistence.
8. Responses are size-, time- and render-bounded and can always be cancelled.
9. Contract or protocol-version mismatch fails closed.
10. Logs are structured, minimal and redacted.
11. CSP `connect-src` is pinned to the approved-endpoint set (`'self'` plus
    explicitly approved origins); no `*`/`https:` wildcard. It is the
    *fetch-class* exfiltration boundary even if script execution is achieved —
    it constrains fetch/XHR/WebSocket/EventSource/`sendBeacon`, **not**
    navigation-based egress (see residual risk below).
12. The contract artifact is trusted only after signature + provenance +
    transparency-log verification (ADR-002); a bare hash is not a trust anchor.

### Residual risk — navigation-based exfiltration (not closed by `connect-src`)

`connect-src` governs only the fetch class of network egress. If script
execution is achieved, an attacker can still exfiltrate by *navigating*:
`location = …`, `window.open`, form `target`-navigation, `<a ping>`, and
`<link rel=prefetch/prerender>` all leave the page (or issue a request) without
crossing `connect-src`. CSP Level 3 has **no** directive that blocks this: the
`navigate-to` directive that would have covered it was never shipped and was
removed from the CSP specification and from browser support data (W3C CSP Level 3;
mdn/browser-compat-data PR #17902 removed `navigate-to`). `frame-src`/
`frame-ancestors` do not cover top-level or popup navigation either.

This residual is **open under this M1 threat model** and is closed only by the
reframed runtime's **navigation allowlist** (ADR-005: navigation, popup,
download and external-protocol actions default-deny, granted per app). Until
that runtime control exists, treat "script execution achieved" as implying a
navigation-exfiltration path that CSP alone does not stop.

## Priority threats and mandatory controls

| Threat | Required control | M1 verification |
|---|---|---|
| Malicious/compromised MCP server | endpoint identity display, two-tier allowlist (curated baseline + consented user-added, deny-by-default), explicit consent, capability deny-by-default | negative integration tests |
| Credential/content exfiltration via injected script | CSP `connect-src` pinned to approved-endpoint set (no `*`/`https:`); UI approval and served policy kept in sync; un-permitted origin fails closed | CSP negative test + exfil E2E |
| Prompt/tool injection in MCP content | treat all remote text as data; no instruction execution from rendered content; safe text rendering | malicious fixture suite |
| Capability spoofing/change | snapshot negotiated capabilities, highlight changes, require renewed consent | capability-change test |
| Credential/session theft | no localStorage/URL/log persistence; short-lived memory state; clear disconnect | storage and log scan |
| SSRF through discovery metadata | HTTPS production policy; reject private/link-local targets where server-side fetch exists; validate every redirect | URL-policy tests |
| OAuth confused deputy/redirect abuse | exact redirect matching, state/PKCE, per-client consent, no wildcard redirect | authorization tests when OAuth lands |
| Token passthrough | validate audience and issuer; never forward arbitrary upstream tokens | adapter unit tests |
| Session hijacking/event injection | authorization on every request; unpredictable session IDs from server; bind events to endpoint and user context | replay/cross-session tests |
| XSS/unsafe rich content | restrictive CSP, no unsafe HTML, sanitized/escaped rendering, no `unsafe-eval` | CSP and injection E2E tests |
| Supply-chain compromise (deps + ENG-01 contract) | lockfile, minimal dependencies, SBOM, dependency review, secret scan; **contract artifact verified by Sigstore signature + SLSA provenance + Rekor inclusion before trust (ADR-002)** | CI gates + contract-verify step |
| Oversized/slow response | maximum bytes/items, timeout, AbortController, backpressure | boundary tests |
| Clickjacking | `frame-ancestors 'none'` unless explicitly changed | header test |
| Data remanence | explicit clear-session action; no sensitive service-worker cache | browser storage inspection |

## Runtime threat surface (T1/T2/T3) — OPEN, tracked in ADR-005/006/007

The M1 table above covers the network-egress and rendering surface of a single
approved target. Running arbitrary foreign web apps locally (T1 → T2 → T3) opens
additional attacker-reachable sub-surfaces that the M1 controls do **not** address.
These are **open** and tracked in the runtime and package spikes (ADR-005/006/007);
they are listed here so the spikes test the right questions, not because a control
exists yet.

- **Navigation-based egress** — as in the residual-risk note above: default-deny
  navigation/popup/download/external-protocol allowlist per app (ADR-005) is the
  control, not CSP.
- **Cross-app process/site isolation** — one hosted app must not read another
  app's memory, storage or renderer state. This requires process-level site
  isolation from the engine (ADR-006), not application-layer checks.
- **Per-app data-domain separation** — cookies, IndexedDB, CacheStorage,
  permissions and download areas must be partitioned by app identity.
- **Custom-scheme secure-context escalation** — serving app content from a custom
  scheme such as `app://` or `isolated-app://` makes it a **secure context**,
  which *unlocks* powerful web features, service-worker registration and
  persistent storage for that content. A custom scheme is therefore not a neutral
  packaging detail; it changes which capabilities foreign content can reach and
  must be gated as such (ADR-007; note that `app://` does not reproduce the
  browser-enforced `isolated-app://` guarantees — see ADR-007 boundaries).
- **Service-worker cross-app leak / SW partitioning per app identity** — a
  service worker registered by one hosted app can persist, intercept requests and
  cache responses; without strict partitioning keyed to app identity, a SW
  becomes a cross-app read/persistence and data-remanence channel. Service-worker
  registration, scope, cache and emergency-removal per app identity must be part
  of the runtime design (ADR-006/007), not assumed benign.
- **Engine security-patch SLA** — a T3 runtime carries the engine's full CVE
  surface; the ability to ship an upstream engine fix on the project's own cadence
  is a hard cut criterion (ADR-006), not a convenience.

None of the above is closed by the M1 static header/CSP work. Adding any T2/T3
capability requires a fresh threat-model review against these classes.

## OWASP Top 10 for Agentic Applications (2026) mapping

APP-01 is an MCP **client** for human-in-the-loop use, so agentic risk is
bounded, but the relevant items are tracked explicitly
([OWASP Gen AI Security Project, 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/),
confidence: high):

| ASI | Title | APP-01 control |
|---|---|---|
| ASI01 | Agent Goal Hijack | result content is untrusted, human-review-only; any future path feeding it to an agent/LLM triggers a fresh injection re-review (see below) |
| ASI02 | Tool Misuse and Exploitation | two-tier endpoint allowlist (curated + consented user-added), deny-by-default, `connect-src` enforcement |
| ASI03 | Identity and Privilege Abuse | audience-bound tokens, no token passthrough, session IDs are not authentication |
| ASI04 | Agentic Supply Chain | signed + provenanced contract artifact (ADR-002), SBOM, dependency review |
| ASI05 | Unexpected Code Execution | no `unsafe-eval`, Trusted Types (**Chromium-only**; not enforced in Firefox/Safari, so it is defence-in-depth, not a cross-browser guarantee — same caveat as `CSP_AND_SECURITY_HEADERS.md` Permissions-Policy note), no local server exec in M1 |

### ASI01 downstream re-review rule

All MCP result content is untrusted data rendered for **humans only** in M1.
The instant any result content is routed into an agent, an LLM prompt, or an
automated decision instead of a human, the threat is re-classified as ASI01
(Agent Goal Hijack, the EchoLeak-class indirect-injection pattern) and a fresh
injection/threat re-review is **mandatory before** that path ships. M1 enables
no such downstream automated consumption.

## Out of scope for M1

Local command execution, one-click installation of local MCP servers, write-capability automation, autonomous tool loops and server-side proxying. Adding any of these requires a new threat-model review.

## Release blockers

Any unbounded HTML rendering, secret persistence, wildcard production endpoint policy, `*`/`https:` in `connect-src`, missing cancellation, missing consent, unpinned or unverified (unsigned/unprovenanced) contract input, or bypassable CSP blocks release.
