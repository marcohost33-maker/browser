# APP-01 Threat Model — M1

- Status: GOOD-DRAFT
- Date: 2026-07-10
- Applies to: public MCP-client webapp

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

## Priority threats and mandatory controls

| Threat | Required control | M1 verification |
|---|---|---|
| Malicious/compromised MCP server | endpoint identity display, allowlist policy, explicit consent, capability deny-by-default | negative integration tests |
| Prompt/tool injection in MCP content | treat all remote text as data; no instruction execution from rendered content; safe text rendering | malicious fixture suite |
| Capability spoofing/change | snapshot negotiated capabilities, highlight changes, require renewed consent | capability-change test |
| Credential/session theft | no localStorage/URL/log persistence; short-lived memory state; clear disconnect | storage and log scan |
| SSRF through discovery metadata | HTTPS production policy; reject private/link-local targets where server-side fetch exists; validate every redirect | URL-policy tests |
| OAuth confused deputy/redirect abuse | exact redirect matching, state/PKCE, per-client consent, no wildcard redirect | authorization tests when OAuth lands |
| Token passthrough | validate audience and issuer; never forward arbitrary upstream tokens | adapter unit tests |
| Session hijacking/event injection | authorization on every request; unpredictable session IDs from server; bind events to endpoint and user context | replay/cross-session tests |
| XSS/unsafe rich content | restrictive CSP, no unsafe HTML, sanitized/escaped rendering, no `unsafe-eval` | CSP and injection E2E tests |
| Supply-chain compromise | lockfile, minimal dependencies, provenance/SBOM, dependency review and secret scan | CI gates |
| Oversized/slow response | maximum bytes/items, timeout, AbortController, backpressure | boundary tests |
| Clickjacking | `frame-ancestors 'none'` unless explicitly changed | header test |
| Data remanence | explicit clear-session action; no sensitive service-worker cache | browser storage inspection |

## Out of scope for M1

Local command execution, one-click installation of local MCP servers, write-capability automation, autonomous tool loops and server-side proxying. Adding any of these requires a new threat-model review.

## Release blockers

Any unbounded HTML rendering, secret persistence, wildcard production endpoint policy, missing cancellation, missing consent, unpinned contract input, or bypassable CSP blocks release.