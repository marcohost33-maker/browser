# CHARTER — APP-01 `browser`

- Status: ACTIVE
- Scope confirmed: 2026-07-10
- Updated: 2026-07-11
- Repository: `marcohost33-maker/browser`

## Purpose

APP-01 is the public, privacy-first browser application and MCP client of the
Vero/Nigin system. It consumes a versioned MCP contract supplied by ENG-01 and
does not define or own that contract.

This repository is not `browser-nigin` and is not an engine/platform runtime.

## Product principles

- **Explicit user control.** Connections, capabilities and requests remain
  visible, bounded, revocable and attributable to a user action.
- **Privacy by default.** Minimize data, retention, permissions, third-party
  dependencies and network destinations.
- **Fail closed.** Unsupported security-critical semantics, unapproved origins,
  invalid contracts and consent drift block execution.
- **Standards-first web application.** Use browser-native capabilities where
  practical; select a framework only with measured evidence.
- **Low operating cost.** The default product should avoid unnecessary paid
  APIs and infrastructure, without weakening security or reliability.
- **Contract consumer, not owner.** ENG-01 supplies the signed, versioned MCP
  contract artifact, fixtures and conformance expectations.
- **Evidence before claims.** Designed, implemented, verified and
  production-ready are separate states.
- **Open-source candidate.** Public release occurs only after security, privacy,
  legal, accessibility, operational and repository-governance gates pass.

## M1 objective

Validate one primary user and one read-only task, then deliver the smallest
browser slice that can:

1. use an endpoint class approved by ADR-003;
2. identify the endpoint, origin, protocol revision and trust tier;
3. negotiate and display capabilities as untrusted data;
4. obtain explicit approval for one bounded read-only request;
5. enforce timeout, cancellation, payload and rendering limits;
6. return a validated result or normalized error;
7. clear all sensitive session state.

## Architectural boundaries

- Presentation cannot call a transport directly.
- Endpoint, credential, capability, consent and storage policy are independent
  enforcement boundaries.
- CSP origins are deployment policy; a user-entered endpoint cannot widen them.
- Runtime code cannot proceed until product, endpoint/deployment and contract
  gates are satisfied.
- Remote production traffic requires HTTPS. Plain HTTP is limited to explicit
  loopback development endpoints.

## Non-goals for M1

- defining an MCP protocol or ENG-01 contract;
- Wasmtime, WIT, WASI, CAS, solver, orchestrator or engine fabric;
- an unrestricted universal MCP browser or marketplace;
- arbitrary user-supplied remote endpoints;
- write tools, autonomous execution, sampling or elicitation;
- persistent credentials or opaque background synchronization;
- a PWA/service worker before its cache and sensitive-data threat model passes.

## Source-of-truth map

- Execution roadmap: `docs/ROADMAP.md`
- Program roadmap: `docs/MASTER_ROADMAP.md`
- Current decisions: `docs/OPEN_DECISIONS.md`
- Architecture decisions: `docs/adr/`
- Security profile: `docs/security/`
- Current implementation state: `docs/IMPLEMENTATION_STATUS.md`
- Vulnerability reporting: `SECURITY.md`

The historical cwzl document that described Wasmtime/WIT/CAS/Engine-Fabric work
is retained only as provenance in
`docs/007_ANALYSE_platform-track_PROVENIENZ.md`; its implementation owner is
ENG-01, not APP-01.
