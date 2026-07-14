# OPEN DECISIONS — `browser`

- Status: ACTIVE REGISTER (product reframed 2026-07-14)
- Updated: 2026-07-14
- Source of implementation work: GitHub issues in `marcohost33-maker/browser`

> **PRODUCT REFRAME (2026-07-14).** `browser` is reframed into a native,
> offline-capable browser/webapp runtime that runs foreign web apps locally (staged
> T1 → T2 → T3; north star **T3**), replacing cloud hosting and running without an AI
> layer, inside the stack `browser` (runtime) · `nigin-engine` (core) · `browser-nigin`
> (AI). The binding decision record for the reframe is **ADR-005/006/007** (PR #22),
> not this register. Decisions below that assume the "MCP client webapp / remote
> endpoint" product are superseded by that canon; their security substance is
> retained.

## Decision states

- `RESOLVED`: accepted and reflected in architecture/roadmap.
- `PROPOSED`: concrete recommendation exists; required evidence is incomplete.
- `OPEN`: alternatives or required evidence are still incomplete.
- `BLOCKED`: an external artifact or preceding decision is missing.

## D1 — Repository scope — RESOLVED (reframed 2026-07-14)

`browser` is a native, offline-capable browser/webapp runtime program that runs
foreign web apps locally (staged T1 → T2 → T3; north star T3), replacing cloud
hosting and running without an AI layer. Engine/contract work (`nigin-engine`) and
the AI layer (`browser-nigin`) are separate repositories. This repository is not
`browser-nigin` and not `nigin-engine`.

Evidence: Charter, ADR-005/006/007 (PR #22), Marco decision 2026-07-14.

> Superseded framing (pre-2026-07-14): "APP-01 is the public privacy-first MCP
> client webapp; Wasmtime/WIT/WASI/CAS/engine work belongs to ENG-01." Retained for
> provenance.

## D2 — M1 primary user and top task — OPEN / P0

Owner issue: #14.

Required decision:

- one primary persona and anti-persona;
- one bounded read-only task;
- measurable task-success and consent-comprehension thresholds;
- go, pivot or stop decision for a public browser client.

No feature expansion may substitute for this evidence.

## D3 — Endpoint trust, browser transport and deployment — SUPERSEDED by ADR-005

Owner issue: #13. Former proposed design: ADR-003 (now SUPERSEDED). The
remote-MCP-endpoint transport/deployment product model is obsolete under the
2026-07-14 reframe. Its network-security substance (egress origin allowlist,
exact-origin `connect-src`, redirect/DNS-rebinding/private-network/metadata
rejection) is framing-neutral and applies to the network egress of locally hosted
apps; it is retained in `docs/security/*`. Runtime trust classes and the runtime
security boundary are now governed by ADR-005/006/007 (PR #22).

Former recommendation (superseded, retained for provenance):

- curated deploy-time HTTPS endpoint set for M1;
- arbitrary remote user-entered origins prohibited;
- full MCP endpoint URL and CSP origin validated separately;
- direct browser transport only when the server's CORS/auth contract passes;
- same-origin gateway remains the fallback when credentials, CORS or operational
  policy make direct transport unsafe or infeasible;
- loopback HTTP permitted only for explicit development.

Acceptance remains blocked on product evidence and a representative endpoint
spike.

## D4 — MCP contract revision and conformance artifact — BLOCKED / P0

ENG-01 must publish the selected revision, schemas/types, positive and negative
fixtures, limits, compatibility policy and signed provenance artifact.

APP-01 must verify signature, provenance, source identity and digest before
production use. Hash-only or manually copied artifacts are mock/development
inputs, not production trust anchors.

## D5 — Application framework, build and browser matrix — OPEN

Owner issue: #7. Output: ADR-004.

This decision follows D2, D3 and D4. The spike compares a minimal standards-first
TypeScript implementation with a mature framework under CSP, accessibility,
bundle, dependency, testability and maintenance constraints.

## D6 — OAuth and credential architecture — BLOCKED

OAuth remains disabled until D3 selects the topology and ENG-01 publishes the
authorization profile and fixtures. Any future browser public-client flow must
use Authorization Code with PKCE, exact redirect matching, issuer/state checks,
audience-restricted tokens and no token persistence in prohibited sinks.

A backend-for-frontend is an explicit architecture choice, not an implicit
credential workaround.

## D7 — PWA and service worker — DEFERRED

No service worker or offline cache in M1. Reconsider only after a dedicated data
classification, cache invalidation, update, revocation and sensitive-data threat
model is accepted.

## D8 — Public/open-source release — BLOCKED

Public release requires, at minimum:

- D2–D6 resolved as applicable;
- runtime, contract, browser E2E and hostile-input evidence;
- privacy sink and accessibility evaluation;
- LICENSE, SECURITY.md, privacy and accessibility statements;
- protected default branch, required checks and code ownership;
- SBOM, release provenance, staging, rollback and incident exercises;
- no P0 or unowned P1 risk.
