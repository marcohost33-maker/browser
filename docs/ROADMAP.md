# ROADMAP — `browser`

- Updated: 2026-07-28
- Scope: only `marcohost33-maker/browser`
- Product: standalone native offline web-application runtime
- Delivery order: T1 → T2 → T3; T1 first release, T3 north star

## M0 — Repository and evidence foundation — COMPLETE

- [x] Standalone repository boundary and non-goals (ADR-008).
- [x] Staged trust classes (ADR-005).
- [x] Static CSP/header/origin enforcement and regression tests.
- [x] Supply-chain, SBOM, evidence and repository-governance foundation.
- [x] Local CI-parity gate.
- [x] CWAP-Strict-JSON v0.1.2 canonical-manifest core promoted for ADR-007 Track B.
- [x] ADR identity and local-link consistency gate added.

## M1 — Decide the smallest T1 product

- [ ] Execute product discovery #14: primary user, anti-persona, top task and go/pivot/stop result.
- [ ] Complete acquisition-mode taxonomy #30.
- [ ] Select the exact T1 install/use workflow: manual offline sideload is mandatory;
  updates remain optional and fully disableable.
- [ ] Define the T1 shell UX, consent, recovery and evidence surfaces without
  encoding a T2/T3 promise.

**Gate M1:** one falsifiable T1 workflow and no unresolved ambiguity between
package installation, captured content, PWA installation and remote browsing.

## M2 — Package identity, verification and activation

- [x] Canonical manifest representation and reject precedence (Track-B part).
- [ ] Select or reject `.swbn`, NAR, ZIP-minimal and other candidates using one
  shared adversarial corpus (#24).
- [ ] Pin exact package specification, parser/verifier versions and licenses.
- [ ] Define signed bytes, app identity, publisher-key binding and algorithm set.
- [ ] Implement independent verifiers and differential/fuzz gates.
- [ ] Enforce file-count, byte, ratio, nesting, path and time limits before allocation/extraction.
- [ ] Implement content-addressed staging, same-volume atomic activation, last-good
  rollback and interruption recovery.

**Gate M2:** zero accepted malicious corpus cases, zero verifier disagreement and
successful recovery for every injected interruption.

## M3 — Secure update metadata

- [ ] Ratify or reject ADR-009 after a measured TUF v1.0.35 spike.
- [ ] Define root, targets/delegations, snapshot and timestamp roles and thresholds.
- [ ] Keep package identity, publisher admission, capability approval and update
  authority separate.
- [ ] Implement rollback, freeze, mix-and-match, wrong-target, endless-data,
  key-rotation and revocation tests.
- [ ] Support offline update bundles and a fully disabled-update mode.
- [ ] Require explicit re-consent for capability expansion.

**Gate M3:** no rollback, freeze, mix-and-match, namespace crossover or unauthorized
capability escalation is accepted.

## M4 — Runtime compatibility and isolation

- [ ] Execute #23 with exact versions and reproducible fixtures.
- [ ] Use Electron as the pragmatic T2 compatibility/harness baseline.
- [ ] Record CEF exit criteria; evaluate it only when Electron fails a measured
  requirement.
- [ ] Reject a project-owned Chromium fork unless staffing and patch-SLA evidence
  changes materially.
- [ ] Enforce one package per process tree and per ephemeral profile/storage partition.
- [ ] Default-deny navigation, popups, downloads, external protocols, permissions,
  service workers and native bridges.
- [ ] Build an outer Linux sandbox/namespace/VM null-egress experiment with OS-level
  network deny, cgroup limits and independent observation.

**Gate M4-T2:** curated signed content runs with no native bridge and bounded
persistence. **Gate M4-T3:** hostile content is contained by a separately reviewed
outer boundary; an Electron/CEF window alone never satisfies T3.

## M5 — Publisher and capability governance

- [ ] Complete #25 publisher admission, namespace ownership and review lifecycle.
- [ ] Use declarative, versioned, least-privilege capability grants.
- [ ] Bind every grant to package identity, version and evidence record.
- [ ] Implement emergency removal, revocation, support expiry and re-review.
- [ ] Prevent signature validity from implying admission or capability approval.

## M6 — Verification and release

- [ ] Hostile package, updater and browser E2E corpora (#5, #11).
- [ ] Privacy sink/canary tests and implementation-derived data-flow documentation.
- [ ] Keyboard, screen-reader and WCAG-oriented critical-flow evaluation.
- [ ] Reproducible signed release artifacts and independent digest comparison.
- [ ] Staging, monitoring, rollback, cache invalidation, incident and key-loss drills.
- [ ] Complete SECURITY.md, privacy notice, accessibility statement and support policy (#6).

## Explicit exclusions

- `nigin-engine` and `browser-nigin` are not dependencies.
- MCP is optional and off the T1 critical path.
- No public claim that T3 is achieved by Chromium sandboxing alone.
- No package format, updater or publisher is trusted because it is popular or signed.
