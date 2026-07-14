# APP-01 Browser — Implementation Status

- Updated: 2026-07-14
- Repository: `marcohost33-maker/browser`
- Product direction: native, offline-capable host for webapps; committed target
  state is running arbitrary foreign webapps
- Trust-scope decision: DECIDED T3 (staged) — Marco G1 (2026-07-14): T1 → T2 →
  T3 maturation with T3 (arbitrary foreign content) as the target state; ADR-005
  ACCEPTED. First shipping increment is T1.
- Status: static security foundation exists; runtime and package architecture are not selected or implemented

## Owner decision and reframe

The prior public MCP-client webapp premise is superseded by the 2026-07-14
product direction. `browser` is now intended to provide the native offline
runtime foundation whose committed end state is running arbitrary foreign
webapps, reached via the staged T1 → T2 → T3 maturation (Marco G1, 2026-07-14;
ADR-005 ACCEPTED). `nigin-engine` remains the engine/contract core, while
`browser-nigin` remains an optional later AI layer.

The trust-class staging is decided (ADR-005 ACCEPTED). The exact runtime
(ADR-006) and package format (ADR-007) remain open architecture decisions and
their ADRs stay PROPOSED pending measured spikes. Draft PR #22 contains the
accepted trust-class ADR plus proposed evidence gates; it is not a runtime,
package or release decision.

## Implemented and merged foundation

- M0 repository scope and APP-01/ENG-01 separation.
- Architecture, privacy, threat-model and MCP-consumer-profile provenance.
- Master roadmap, open-topics register and source/standards policy.
- Contract-artifact signing/provenance design.
- Machine-readable CSP and security-header baseline.
- Executable CSP serializer and fail-closed validation.
- Exact-origin `connect-src` allowlist enforcement.
- Protection against CSP override, source-token injection and header splitting.
- Security CI using Node's built-in test runner.
- Real HTTP-response integration tests for served headers.

These controls are reusable inputs. They do not validate the new native runtime
product or prove hostile-content isolation.

## Draft security and governance foundation

PR #17 contains additional CI, SBOM, evidence, security-policy and governance
work. It remains Draft and still carries the previous public-webapp product
premise in several documents. Its product-neutral controls should be reduced or
transplanted only after the reframe decisions are accepted.

## Open P0 decisions

1. Trust-class staging: DECIDED (Marco G1, 2026-07-14; ADR-005 ACCEPTED) —
   T1 → T2 → T3 with T3 as the target state. Vero cross-family adjudication of
   the ADR remains open.
2. Execute the common runtime evaluation in ADR-006; for the T3 target the
   APP-01 shortlist focus is Chromium-based (Electron/CEF) with a shippable
   engine security-patch path as a hard cut criterion.
3. Execute the `.swbn` and minimal-package verifier comparison in ADR-007.
4. Define per-app identity, storage/profile separation and capability brokering.
5. Specify manual install, optional updates, rollback, revocation and key rotation.
6. Decide whether PR #17 is reduced, transplanted or closed.
7. Complete Vero cross-family adjudication and accountable owner approval.

## Production-readiness boundary

APP-01 is not a functioning native runtime and is not production-ready. Missing
evidence includes runtime prototypes, package verification, parser fuzzing,
per-platform isolation, update/rollback exercises, accessibility, privacy data
flows, legal classification, release provenance, incident response and an
independent final-head review.
