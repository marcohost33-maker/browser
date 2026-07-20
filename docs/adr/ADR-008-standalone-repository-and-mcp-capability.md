# ADR-008 — `browser` is a Standalone Repository; MCP is an Internal Optional Capability

- Status: ACCEPTED
- Date: 2026-07-16
- Decision owner: Marco
- Decision: Marco 2026-07-16 — `browser` is a self-standing product; the previously
  documented "three-layer stack" coupling to `nigin-engine` and `browser-nigin` is
  withdrawn as an *architectural* dependency and downgraded to knowledge-transfer only
- Supersedes: the "three-layer stack" / "contract consumer of `nigin-engine`" framing
  in README, CHARTER, ROADMAP, MASTER_ROADMAP, OPEN_DECISIONS, IMPLEMENTATION_STATUS,
  PRODUCTION_READINESS_MATRIX, ADR-001, ADR-002, the reframe checklist and the product
  discovery protocol (framing only; their security/governance substance is retained)

## Context

Earlier records (ADR-005/006/007, PR #22 and the 2026-07-14 reframe) describe
`browser` as one layer of a **three-layer stack**: `browser` (runtime) ·
`nigin-engine` (contract core) · `browser-nigin` (AI layer). Several documents make
that coupling load-bearing — e.g. ADR-002 and OPEN_DECISIONS D4 make a **signed
`nigin-engine` contract a P0 prerequisite** for `browser`, and the readiness matrix
G3 (`MCP-01…05`) is `BLOCKED` on an external `nigin-engine` artifact.

Marco's decision of 2026-07-16 corrects that framing: **`browser` is standalone.**
`browser`, `nigin-engine` and `browser-nigin` are **not a family and not a coupled
stack**; they are linked **only by knowledge transfer** (shared security lessons,
supply-chain patterns, evidence discipline). `browser` must be describable, buildable,
shippable and useful **without either other repository existing.**

## Decision

1. **Standalone product identity.** `browser` is a native, offline-capable
   browser/webapp **runtime program** that runs foreign web apps locally (staged
   T1 → T2 → T3; north star T3, per ADR-005). It has no architectural dependency on
   `nigin-engine` or `browser-nigin`. Cross-repository links are knowledge transfer,
   not build/runtime/release dependencies.

2. **MCP is an internal, optional capability — not an external dependency.** MCP
   consumption legitimately *belongs in* `browser` and may be implemented as a
   `browser`-internal capability. It **may** also be run as a separate concern. Either
   way:
   - MCP is **not** on the T1 critical path. T1 (run owner-controlled offline
     webapps) requires no MCP endpoint, no remote contract and no `nigin-engine`
     artifact.
   - Any MCP contract `browser` chooses to consume may be sourced **internally** or
     from **any** signed producer; it is not, by architecture, the `nigin-engine`
     artifact. The signature/provenance-verification *discipline* in ADR-002 is
     retained and re-pointed at "whatever signed contract `browser` consumes", with no
     named external producer.
   - The remote-MCP-web-client product framing (old ADR-001/003 narrative) stays
     **superseded**; its network-security substance stays in `docs/security/*`.

3. **Documentation consequence (sweep pending).** The "three-layer stack" sentence
   and every "`nigin-engine` contract is required" statement are **superseded by this
   ADR**. Until the mechanical sweep lands, this ADR is the tie-breaker: where any doc
   still asserts the stack coupling or a hard `nigin-engine` dependency, **this ADR
   wins.** The sweep must:
   - remove "one layer of a three-layer stack" from README/CHARTER/ROADMAP/etc.;
   - restate exclusions as "`browser` is not `browser-nigin` and not `nigin-engine`
     (separate, independent repositories; knowledge-transfer only)";
   - reframe D4/ADR-002/`MCP-01…05` from "blocked on `nigin-engine`" to "optional
     internal capability; no external producer assumed";
   - keep all IDs immutable (no ADR renumbering).

## Non-goals of this ADR

- It does not change the accepted trust-class staging (ADR-005) or the runtime /
  package spikes (ADR-006/007).
- It does not decide *whether* or *when* `browser` ships MCP — only that MCP, if
  shipped, is internal/optional and off the T1 critical path.
- It does not delete provenance; superseded framing is retained as history.

## Consequences

- The T1 critical path shortens: product discovery (#14) → runtime spike (ADR-006 /
  #23) → package spike (ADR-007 / #24) → secure app bootstrap → owner-controlled
  offline vertical slice. **No external contract gate blocks T1.**
- Issues assuming the remote-MCP-endpoint product (#2, #13) are **superseded** and
  should be closed or relabelled (see report); the MCP-consumer work they imply, if
  retained, moves to a `browser`-internal optional track with no `nigin-engine`
  blocker.
- `docs/007_ANALYSE_platform-track_PROVENIENZ.md` (which routes platform-track work to
  `nigin-engine`) remains valid **as provenance only** and is not a dependency claim.

## Evidence

- Marco decision, 2026-07-16 (fixed to Vero memory `project_nigin_platform_browser_repo`).
- Grep of superseded framing across 12 files (README, CHARTER, ROADMAP, MASTER_ROADMAP,
  OPEN_DECISIONS, IMPLEMENTATION_STATUS, PRODUCTION_READINESS_MATRIX, ADR-001, ADR-002,
  BROWSER_REFRAME_DECISION_CHECKLIST, PRODUCT_DISCOVERY_PROTOCOL, VALIDATION_AND_OPEN_TOPICS).
