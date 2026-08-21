# OPEN DECISIONS — `browser`

- Status: ACTIVE REGISTER
- Updated: 2026-07-28
- Source of execution truth: GitHub issues and accepted ADRs in `marcohost33-maker/browser`

## State vocabulary

- `RESOLVED`: binding decision reflected in architecture and roadmap.
- `PARTIAL`: a bounded sub-decision is accepted; the parent decision remains open.
- `PROPOSED`: recommended direction exists; measured acceptance evidence is incomplete.
- `OPEN`: alternatives or owner evidence remain incomplete.
- `FAIL-CLOSED`: work may be researched, but no promotion or security claim is permitted.

## D1 — Repository and product boundary — RESOLVED

`browser` is a standalone native, offline-capable runtime for locally executed web
applications. Delivery is staged T1 → T2 → T3; T1 is the first release scope and T3
the north star. `nigin-engine` and `browser-nigin` are separate repositories and not
dependencies. MCP is internal, optional and off the T1 critical path.

Binding records: ADR-005 and ADR-008.

## D2 — Primary user and T1 task — OPEN / P0

Owner issue: #14.

Required outcome:

- one primary persona and anti-persona;
- one bounded offline task;
- one manual-sideload workflow;
- measurable success, consent and recovery criteria;
- go, pivot or stop result.

## D3 — Offline acquisition mode — OPEN / P0

Owner issue: #30.

The project must separately decide the semantics of:

- signed packaged application;
- already-installed PWA;
- captured/archive replay;
- ordinary remote browsing.

These modes have different origin, identity, update, storage and compatibility
properties and must not share an ambiguous "offline webapp" claim.

## D4 — Package format and verifier — PARTIAL / P0

Owner issue: #24. Binding records: ADR-007 and ADR-007a.

Resolved subset:

- CWAP-Strict-JSON v0.1.2 is the accepted canonical-manifest profile for its
  restricted input domain.
- Unicode noncharacter handling (letter item E7, 2026-07-19) is decided as
  pass-through: a conforming verifier must not reject a codepoint for being a
  noncharacter. Measured across all three implementations, test-borne and
  rollback-probed (2026-08-21). Record: `spike/cwap-canonical-json/SPEC_v0.1.2_DRAFT.md`,
  section "E5/E6/E7".

Still open:

- `.swbn`, NAR, ZIP-minimal or another exact container — a sourced side-by-side
  comparison with a recommendation now exists for the owner decision:
  `docs/reports/2026-08-21_CWAP_CONTAINERFORMAT_ENTSCHEIDUNGSVORLAGE.md`
  (proposal: NAR; effort figures are estimates, no candidate has been run against
  the shared adversarial corpus yet);
- signed-byte scope and package identity;
- strict signature-verifier implementation;
- resource limits, extraction, staging, activation and recovery;
- independent parser/verifier and fuzz evidence.

Two limits from the same letter remain open and are now stated rather than
implied:

- **E5 — duplicate-detection cost.** All three implementations are O(n log n) or
  better today (measured 2026-08-21: 200 000 keys in 0.74 s Python / 0.17 s Rust /
  0.45 s JS). What is undecided is the *normative form* — a complexity MUST for
  every conforming implementation, or a CI recommendation with a time budget.
  Code cannot answer a normative question; the owner must.
- **E6 — maximum verifier input size.** No implementation has any size limit; an
  8 MiB input is accepted. The "4 MiB, fail-closed" figure in circulation is the
  letter's *proposal*, never implemented, with neither code nor test behind it.
  Deciding it belongs to ADR-007a section 1, whose "manifest bytes before parsing"
  requirement is currently unmet.

A canonical manifest is not an accepted package format.

## D5 — Secure update metadata — PROPOSED / P0

Binding proposal: ADR-009. Parent issue: #24 Track C.

Evaluate TUF v1.0.35 with a project-specific POUF and explicit offline profile.
Manual offline sideload remains mandatory; automatic update is optional and fully
disableable. The decision must cover key thresholds, delegation, rollback, freeze,
mix-and-match, revocation, capability expansion and key-loss recovery.

## D6 — Runtime selection — PROPOSED / P0

Owner issue: #23. Binding protocol: ADR-006.

Current hypothesis:

- Electron is the pragmatic compatibility and T2 harness baseline;
- CEF requires a measured Electron exit criterion;
- a project-owned Chromium fork is rejected under current staffing assumptions;
- T3 requires an outer OS/container/VM boundary and independently observed
  null-egress; Chromium sandboxing remains defense in depth.

No runtime is accepted before measured spike evidence.

## D7 — Publisher admission and capabilities — OPEN / P1

Owner issue: #25.

Signature validity, publisher admission, code review, capability approval and update
authority are separate states. Required decisions include namespace ownership,
review lifecycle, least-privilege grants, emergency removal, support expiry and
capability-expansion re-consent.

## D8 — Service workers and persistence — DEFERRED / FAIL-CLOSED

Service workers, persistent shared profiles and cross-version cache retention are
disabled by default. They require dedicated cache/update/revocation/privacy evidence
and an emergency-removal path.

## D9 — Public and production release — BLOCKED

Public or production release requires the applicable D2–D8 decisions plus package,
update, runtime, hostile-input, privacy, accessibility, provenance, rollback and
incident evidence. No P0 or unowned P1 may remain.
