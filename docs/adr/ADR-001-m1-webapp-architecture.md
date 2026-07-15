# ADR-001 — M1 Browser Application Boundaries

- Status: SUPERSEDED by ADR-005 (offline runtime trust classes)
- Decision date: 2026-07-10
- Revalidated: 2026-07-11
- Superseded: 2026-07-14
- Scope: APP-01 `browser` only

> **SUPERSEDED (2026-07-14).** Marco's product decision of 2026-07-14 sets the
> north star for `browser` to a native, offline-capable browser/webapp **runtime
> program** that executes arbitrary foreign web applications locally (trust-class
> target **T3**), replaces cloud hosting, and runs without any AI layer. `browser`
> is **standalone** (ADR-008, 2026-07-16): `nigin-engine` and `browser-nigin` are
> separate, independent repositories linked only by knowledge transfer (not
> dependencies). That reframe is canonized in **ADR-005** (offline
> runtime trust classes), **ADR-006** (runtime evaluation protocol) and **ADR-007**
> (signed package evaluation), which are the binding reframe record (see PR #22;
> ADR-005 is under cross-family review / Vero adjudication and is not yet ACCEPTED).
> This ADR's product framing — APP-01 as a public, browser-based MCP *client*
> webapp that consumes remote MCP endpoints — is therefore obsolete. The text below
> is retained unchanged for historical readability and because its
> enforcement-boundary substance (dependencies point inward, presentation cannot
> call a transport directly, capability deny-by-default, fail-closed policy) remains
> largely framing-neutral. Where it asserts the MCP-client-webapp product form, it
> is overruled by ADR-005/006/007. Do not treat the "M1 slice" or "MCP adapter"
> product statements below as current.

## Decision

APP-01 is a browser-based TypeScript application with a narrow, strictly typed
MCP adapter boundary. It consumes, but never defines, the signed and versioned
ENG-01 contract.

This ADR accepts the durable architectural boundaries. It does not select a UI
framework, endpoint topology, OAuth flow or production MCP revision; those
belong to ADR-003, ADR-004 and the pinned contract decision.

## Constraints

- TypeScript uses strict compiler settings for application/runtime code.
- Standards-first browser APIs are preferred where they reduce dependencies and
  remain maintainable.
- Package manager, runtime major and lockfile are pinned in CI.
- Production code must run under restrictive CSP without `unsafe-eval` or broad
  network scheme sources.
- Sensitive values must not persist in Web Storage, IndexedDB, URLs, history,
  analytics, crash reports, diagnostics or console logs.
- Production remote endpoints require HTTPS; plain HTTP is explicit loopback
  development only.
- MCP transport, revision negotiation, authorization, runtime validation,
  cancellation, timeout, limits, redaction and error translation remain behind
  one adapter boundary.
- Presentation code cannot call a transport directly.
- Capability descriptions, annotations, prompts, resources and results are
  untrusted data.
- A capability is unavailable until policy and explicit user consent allow the
  specific bounded operation.

## Layers

1. **Presentation** — endpoint/trust display, consent, capabilities, request,
   result, error, privacy and recovery states.
2. **Application** — explicit user intent, state machine and use-case
   orchestration.
3. **MCP adapter** — protocol revision, transport, message validation,
   cancellation, limits and normalized errors.
4. **Security and privacy policy** — endpoints, origins, capabilities, consent,
   credentials, storage, rendering and diagnostics.
5. **ENG-01 contract input** — signed schemas/types, fixtures and conformance
   expectations supplied by the contract owner.

Dependencies point inward. External input reaches presentation/application only
after boundary validation and policy checks.

## M1 slice

After the product, endpoint and contract gates pass, a user can:

1. select an endpoint permitted by ADR-003 deployment policy;
2. inspect endpoint/operator/protocol identity;
3. inspect negotiated capabilities as untrusted data;
4. approve one bounded read-only request with visible arguments;
5. cancel or time out the operation;
6. receive a validated, safely rendered result or normalized error;
7. clear all sensitive session state.

## Deferred decisions

- ADR-003: endpoint trust, browser transport and deployment.
- ADR-004: framework, build tool, browser matrix and PWA decision.
- OAuth: after ADR-003 and the ENG-01 authorization profile.
- Service worker/offline behavior: after a dedicated cache/data threat model.
- Write tools, sampling, elicitation and autonomous execution: outside M1.

## Quality gates

- deterministic install and build;
- typecheck, lint, unit, integration and browser E2E tests;
- dependency, workflow, secret, SBOM and provenance checks;
- CSP/security headers verified on real responses;
- hostile-input, exfiltration and sensitive-sink tests;
- keyboard, focus, zoom/reflow and assistive-technology evaluation;
- contract fixtures version-pinned and verified before use;
- staging, rollback and incident evidence before production claims.

## Consequences

- Current JavaScript security utilities are a pre-runtime enforcement foundation,
  not the final TypeScript application architecture.
- No runtime MCP implementation proceeds while #14, ADR-003 and the contract
  gate remain incomplete.
- Future changes that let UI code bypass the adapter or policy boundary require
  a superseding ADR.

## Primary sources

- MCP architecture and lifecycle:
  `https://modelcontextprotocol.io/specification/2025-11-25/architecture`
- MCP transports:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports`
- MCP security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
- TypeScript strict mode:
  `https://www.typescriptlang.org/tsconfig/strict.html`
