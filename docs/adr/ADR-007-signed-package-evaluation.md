# ADR-007 — Signed Offline Package Evaluation

- Status: PROPOSED, with Track-B manifest sub-decision accepted
- Date: 2026-07-14
- Updated: 2026-07-28
- Depends on: ADR-005
- Related: ADR-007a, ADR-009, issues #24, #25 and #30
- Decision owner: Marco

## Context

T1 requires owner-controlled offline applications to have deterministic identity and
verifiable provenance. T2 additionally requires publisher admission and capability
governance. T3 may need compatibility with foreign packaging and browser semantics.
These are related but distinct decisions.

A package signature answers only whether exact signed bytes were authorized by a
key. It does not establish publisher admission, code safety, capability approval,
update freshness or runtime isolation.

## Current decision state

The **canonical-manifest representation** from Track B is accepted:
`CWAP-Strict-JSON v0.1.2` is a restricted-domain canonical JSON profile with
owner-approved error precedence and differential/oracle evidence.

This acceptance does **not** select a container or complete a package verifier. The
following remain open:

- the exact package container and on-wire grammar;
- which bytes are signed and hashed;
- app identity and publisher-key binding;
- parser/verifier implementation and resource limits;
- safe extraction, staging, activation and recovery;
- publisher admission and capability approval;
- secure update metadata and key recovery.

## Architectural separation

The implementation must preserve five independent outcomes:

1. `package-integrity-valid` — exact package identity and signature verified;
2. `publisher-admitted` — the key/publisher is authorized for the namespace;
3. `code-reviewed` — review and test evidence satisfies the trust class;
4. `capability-approved` — exact grants are approved for this package/version;
5. `update-authorized` — metadata proves freshness, consistency and authority.

No state implies another.

## Candidate tracks

### Track A — Signed Web Bundle / IWA compatibility

Evaluate a pinned Signed Web Bundle and Integrity Block revision with exact tool
versions. Measure parsing, signature verification, bundle identity, duplicate
resource handling, canonical URLs, limits, key rotation and resource serving.

Track A is a reference architecture and interoperability candidate. A custom host
must not claim Chrome's `isolated-app://` origin, storage, CSP, isolation, permission
or update guarantees unless it independently implements and tests them.

### Track B — Project-controlled package

The accepted manifest core may be combined with a project-controlled container only
when the complete package format is smaller and more auditable than Track A.
Candidates include a canonical single-pass archive such as NAR and a tightly
restricted ZIP profile. The shared corpus must falsify each candidate rather than
selecting one by preference.

Track B requires the consolidated controls in ADR-007a.

### Track C — Secure update metadata

Track C is specified separately in ADR-009. The package format and update metadata
must remain separable: a package can be immutable and correctly signed while an
update is stale, rolled back, unauthorized or inconsistent.

## Shared adversarial corpus

Every container/verifier candidate must handle or reject:

- payload or manifest modification after signing;
- ambiguous, duplicate, colliding or undeclared paths/resources;
- malformed, truncated, unsupported and recursively nested structures;
- excessive counts, sizes, ratios, allocation and execution time;
- path traversal, absolute/UNC/device/ADS/reparse/symlink cases;
- Unicode normalization, case-fold and filename-source differentials;
- unsupported or downgraded algorithms and versions;
- unauthorized key, namespace crossover and app-id substitution;
- capability expansion hidden in an update;
- old-version replay, freeze, mix-and-match and rollback;
- interrupted installation, partial activation and failed cleanup;
- parser/verifier disagreement across independent implementations.

## Decision criteria

Select a package path only when it:

- has an exact, versioned specification and deterministic identity;
- minimizes parser differential and malleability surface;
- has at least two independent verifier implementations or a justified equivalent;
- survives the shared adversarial corpus and coverage-guided fuzzing;
- supports bounded verification before extraction;
- supports atomic activation, last-good rollback and key recovery;
- can be maintained and patched within the project's staffing model;
- does not imply unimplemented host/runtime guarantees.

Performance cannot compensate for an accepted malicious package, verifier memory
safety failure, namespace crossover, rollback, freeze bypass or unauthorized
capability expansion.

## Deliverables before acceptance

- [x] canonical manifest sub-profile accepted and promoted;
- [ ] exact candidate specifications, versions, dependencies and licenses pinned;
- [ ] property-parity matrix for Track A;
- [ ] shared corpus versioned and hashed;
- [ ] independent differential and fuzz evidence;
- [ ] signed-byte, identity and publisher-key model;
- [ ] safe extraction, activation and interruption recovery evidence;
- [ ] ADR-009 update-security decision and tests;
- [ ] publisher admission and capability-governance decision;
- [ ] independent security review;
- [ ] owner records selected/rejected tracks and residual risk.

No package format or production verifier is accepted while any required item remains
open.
