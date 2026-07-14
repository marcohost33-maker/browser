# CHARTER — `browser`

- Status: ACTIVE (product reframed 2026-07-14)
- Scope confirmed: 2026-07-10
- Updated: 2026-07-14
- Repository: `marcohost33-maker/browser`

> **PRODUCT REFRAME (2026-07-14) — read first.** Marco's decision of 2026-07-14
> resets the north star: `browser` is a **native, offline-capable browser/webapp
> runtime program** that executes arbitrary foreign web applications **locally**,
> replacing cloud hosting, and running **without any AI layer**. It is one layer of
> a three-layer stack: **`browser` (runtime) · `nigin-engine` (contract core) ·
> `browser-nigin` (AI layer)**. Capability is delivered in staged trust classes —
> **T1** (owner-controlled packages) → **T2** (curated third-party) → **T3**
> (arbitrary foreign web content); the accepted north star is **T3**. The binding
> reframe record is **ADR-005** (offline runtime trust classes), **ADR-006**
> (runtime evaluation protocol) and **ADR-007** (signed package evaluation); see
> PR #22 — not duplicated here. Runtime-direction consideration for T3: a
> Chromium-based engine (CEF/Electron) is favoured for inherited site-isolation and
> a maintained engine security-patch path over a Tauri/system-WebView approach; the
> engine security-patch SLA is a central cut criterion. The binding runtime-framework
> choice is deferred to the measured comparison in ADR-006 — no framework is accepted
> here. Everything below that describes `browser` as a "public MCP client webapp
> consuming remote endpoints" is **superseded product framing**, retained because
> its security/privacy/governance substance stays valid; it is overruled by
> ADR-005/006/007 where the two conflict.

## Purpose

`browser` is a native, offline-capable runtime that executes locally installed web
applications, staged from owner-controlled (T1) toward arbitrary foreign web
content (T3). It replaces cloud/edge hosting for those apps and runs without an AI
layer. It is not `browser-nigin` (the AI layer) and does not define or own the
contract core (`nigin-engine`).

> Historical framing (superseded 2026-07-14): "`browser` is the public,
> privacy-first browser application and MCP client of the Vero/Nigin system,
> consuming a versioned MCP contract supplied by ENG-01." Retained for provenance.

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
