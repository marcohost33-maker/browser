# ROADMAP — `browser`

> Scope: only `marcohost33-maker/browser`. **Product reframed 2026-07-14:**
> `browser` is a native, offline-capable browser/webapp **runtime program** that
> runs foreign web apps locally (staged T1 → T2 → T3; north star **T3**), replaces
> cloud hosting and runs without an AI layer. Three-layer stack: `browser` (runtime)
> · `nigin-engine` (contract core) · `browser-nigin` (AI layer). Binding reframe
> record: **ADR-005/006/007** (PR #22). The "MCP client webapp" wording below is
> superseded product framing; the milestone/gate discipline is retained. This
> repository is not `browser-nigin` and not `nigin-engine`.

## M0 — Charter and scope — COMPLETE

- [x] APP-01/ENG-01 boundary and non-goals.
- [x] Active Charter and source-of-truth map.
- [x] Historical engine-track material retained as provenance only.

## M1A — Product and architecture gates

- [x] ADR-001: browser application and enforcement boundaries. **SUPERSEDED by ADR-005** (enforcement-boundary substance retained).
- [x] ADR-002 accepted target design: signed/provenanced contract input (framing realigned to `nigin-engine`).
- [x] Product-discovery protocol prepared for #14 (to be re-scoped to the runtime product).
- [x] ADR-003 proposed: curated endpoint, CORS and deployment model. **SUPERSEDED by ADR-005** (network-security substance retained in `docs/security/*`).
- [ ] Execute #14 and record go/pivot/stop evidence.
- [ ] Complete representative endpoint/CORS/auth spike and accept ADR-003 (#13).
- [ ] Receive and verify signed ENG-01 contract, fixtures and conformance flow.
- [ ] Complete ADR-004 framework/build/browser spike (#7).

**Gate M1A:** no real MCP runtime, OAuth implementation or dynamic endpoint
support before product, ADR-003 and contract evidence pass.

## M1B — Secure repository and application foundation

Implemented or included in PR #17:

- [x] Node 22 security-policy core with no runtime dependencies.
- [x] Complete fail-closed CSP/security-header policy and regression suite.
- [x] HTTPS production origins; loopback-only HTTP development origins.
- [x] Deterministic npm lockfile and `npm ci --ignore-scripts` gate.
- [x] Security, documentation and workflow-security CI.
- [x] SPDX SBOM artifact generation in CI.
- [x] CODEOWNERS, SECURITY.md, Dependabot cooldowns and PR template.
- [x] MIT license matching package metadata.

Still required after ADR-004:

- [ ] Strict TypeScript webapp bootstrap and pinned build toolchain.
- [ ] Lint, format, typecheck, unit, integration and browser E2E harnesses.
- [ ] Secret scanning, dependency review and appropriate SAST.
- [ ] Contract verification workflow and contract lock.
- [ ] Release artifact provenance and reproducibility evidence.
- [ ] Enforced branch protection/ruleset with required checks and code-owner
  review.
- [ ] No baseline telemetry, ads, remote fonts or unnecessary CDNs.

## M1C — Privacy-first read-only vertical slice

Blocked by M1A:

- [ ] Select only an endpoint present in deployment policy.
- [ ] Display endpoint URL, canonical origin, operator, trust tier and protocol.
- [ ] Initialize and negotiate capabilities through the MCP adapter.
- [ ] Treat capability metadata and remote content as untrusted.
- [ ] Approve exactly one bounded read-only request with visible arguments.
- [ ] Enforce cancellation, timeout, byte, depth, item and render limits.
- [ ] Validate and safely render result data.
- [ ] Normalize transport, protocol, auth, timeout, cancellation and schema
  errors.
- [ ] Clear credentials and sensitive state from memory, URL, caches, DOM and
  diagnostics.
- [ ] Keep selectable endpoints, full endpoint URLs and served CSP origins
  synchronized by construction.

## M1D — Verification and release gate

- [ ] Contract positive and negative conformance suite.
- [ ] Malformed, duplicate, late and out-of-order JSON-RPC tests.
- [ ] Capability drift, replay, injection, oversize and redirect tests.
- [ ] Browser exfiltration and prompt/content-injection E2E (#11).
- [ ] Sensitive-data canary test for storage, history, DOM, console and exports.
- [ ] Automated plus manual WCAG-2.2-oriented critical-flow evaluation.
- [ ] Implementation-derived data flow, Privacy Notice and Accessibility
  Statement.
- [ ] Staging deployment of an attested artifact.
- [ ] Monitoring, support, rollback, cache invalidation and incident tabletop.

**Gate M1:** all required evidence linked; no P0 or unowned P1; contract and
endpoint policy pinned; consent cannot be bypassed; browser, privacy,
accessibility, security, supply-chain and rollback tests pass.

## M2 — Separate ADR required

OAuth expansion, PWA/service worker, persisted endpoints, arbitrary remote
endpoints, local MCP servers, write tools, sampling, elicitation, marketplace
features and autonomous execution each require a separate product, architecture
and threat-model decision.

## Explicitly outside APP-01

Wasmtime host, WIT ownership, WASI guest/host, CAS, engine fabric, solver and
orchestrator.
