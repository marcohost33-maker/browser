# ADR-001 — M1 Webapp Architecture

- Status: PROPOSED
- Date: 2026-07-10
- Scope: APP-01 `browser` only

## Decision

Build APP-01 as a TypeScript single-page web application with a narrow, strictly typed MCP client boundary. APP-01 consumes, but never defines, the ENG-01 MCP contract.

Initial stack constraints:

- TypeScript with strict compiler settings.
- Standards-first browser APIs; framework selection remains reversible until the first UI spike.
- Package manager and lockfile are mandatory and pinned in CI.
- Unit tests plus browser-level end-to-end tests.
- Production build must run under a restrictive Content Security Policy without `unsafe-eval`.
- No secret-bearing value may be persisted in localStorage, IndexedDB, URLs, analytics, crash reports, or console logs.
- Remote MCP connections require HTTPS in production. Loopback HTTP is development-only and must be explicitly enabled.
- MCP transport, authorization, schema validation, cancellation, timeout and error translation live behind one adapter boundary.

## Architectural boundaries

1. **Presentation**: connection setup, consent, capability display, request/result and privacy status.
2. **Application**: explicit user intent, use-case orchestration and state transitions.
3. **MCP adapter**: protocol/version negotiation, typed messages, cancellation, error taxonomy and redaction.
4. **Security policy**: endpoint validation, capability allow/deny decisions, storage policy and audit events.
5. **ENG-01 contract inputs**: versioned schemas, fixtures and conformance expectations supplied by the contract owner.

No UI component may call the transport directly.

## M1 vertical slice

A user can configure an allowed endpoint, inspect negotiated capabilities, explicitly approve one read-only request, cancel it, and receive a bounded, safely rendered result or a normalized error.

## Deferred decisions

- UI framework after a small CSP/accessibility spike.
- PWA/service worker only after cache and sensitive-data threat analysis.
- OAuth flow only after ENG-01 publishes the supported authorization profile and test fixtures.
- Write-capability execution is outside the first slice.

## Quality gates

- Typecheck, lint, unit and E2E tests pass.
- Dependency, secret and SBOM checks run in CI.
- CSP and security headers are verified in an integration test.
- Keyboard and focus smoke tests pass.
- Contract fixtures are version-pinned; incompatible versions fail closed.

## Rationale

The MCP specification uses stateful JSON-RPC connections and capability negotiation, and requires clear user control, consent and privacy protections. A single adapter boundary reduces protocol coupling and gives APP-01 a testable enforcement point without taking ownership of ENG-01 contracts.