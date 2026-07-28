# `browser` — Master Roadmap v3

- Status: ACTIVE / evidence-gated
- Updated: 2026-07-28
- Repository: `marcohost33-maker/browser`
- Product: standalone native offline web-application runtime
- Delivery: T1 owner-controlled → T2 curated third-party → T3 arbitrary foreign content
- First release: T1
- North star: T3 with an outer isolation boundary

## 1. Programme objective

Deliver a native runtime that installs and executes signed web applications locally
without requiring an AI layer or an external engine repository. `nigin-engine` and
`browser-nigin` remain independent. MCP is an optional internal capability and is
off the T1 critical path.

Four maturity states remain distinct:

1. **Designed** — requirements, decisions and threat models exist.
2. **Implemented** — code exists and passes local checks.
3. **Verified** — independent/reproducible evidence satisfies the gate.
4. **Production-ready** — release, operations, rollback and incident exercises pass.

No lower state may be described as a higher one.

## 2. Current verified state

### Implemented foundation

- static CSP, security-header and origin enforcement;
- negative regression tests and real served-header readback;
- deterministic npm and workflow policy;
- SBOM/evidence and protected-main foundations;
- CWAP-Strict-JSON v0.1.2 canonical-manifest core;
- local CI-parity and ADR-governance gates.

### Not implemented

- package container/verifier and strict signature path;
- installer, atomic activation and recovery;
- TUF client/repository and offline update bundles;
- publisher/capability governance;
- native runtime host and per-app isolation;
- T3 outer sandbox/null-egress evidence;
- production privacy, accessibility and operations.

## 3. Binding decision map

- **ADR-001** — historical application boundary; superseded by ADR-005.
- **ADR-002** — signed artifact provenance discipline; retained where applicable.
- **ADR-003** — historical remote-endpoint topology; superseded by ADR-005/008.
- **ADR-004** — not landed; former MCP-webapp framework decision superseded.
- **ADR-005** — staged T1/T2/T3 trust classes.
- **ADR-006** — measured runtime evaluation protocol.
- **ADR-007** — signed package evaluation; Track-B manifest subset accepted.
- **ADR-007a** — package-verifier and activation hardening requirements.
- **ADR-008** — standalone repository and optional/internal MCP.
- **ADR-009** — proposed TUF v1.0.35 update-metadata evaluation.

ADR identifiers are unique and immutable. Sub-decisions use explicit suffixes.

## 4. Critical path

```text
#14 product discovery + #30 acquisition-mode decision
  -> #24 container/signed-byte/verifier decision
  -> ADR-009 Track-C update metadata and recovery spike
  -> package verifier + atomic installer
  -> #23 Electron compatibility harness
  -> outer T3 Linux isolation/null-egress experiment
  -> #25 publisher and capability governance
  -> T1 vertical slice
  -> hostile-input, privacy, accessibility and release gates
```

Workstreams may overlap only when they do not silently choose another workstream's
open trust boundary.

## 5. Workstreams and gates

### WS-0 — Governance and source of truth

Deliverables:

- README, implementation status, roadmap and decision register synchronized;
- unique ADR identifiers and valid local ADR links;
- GitHub issues own open implementation work;
- historical/advisory records clearly marked.

Gate G0:

- no duplicate ADR identity;
- no closed/superseded gate listed as active;
- every P0/P1 has an owner and exit criterion;
- no unsupported production or T3 claim.

### WS-1 — Product discovery and acquisition semantics

Owner issues: #14 and #30.

Deliverables:

- primary persona and anti-persona;
- one T1 offline task;
- manual sideload workflow and recovery UX;
- separate semantics for package, PWA, capture/replay and remote browsing;
- go/pivot/stop decision.

Gate G1: one falsifiable T1 workflow with measurable success, consent and recovery.

### WS-2 — Package identity and verifier

Owner issue: #24. Binding records: ADR-007 and ADR-007a.

Deliverables:

- exact container/specification selection or rejection;
- exact signed-byte and identity model;
- independent strict verifiers;
- resource envelope and adversarial corpus;
- manifest↔payload bijection;
- content-addressed staging, atomic activation and last-good rollback.

Gate G2: zero accepted malicious cases, zero accepted parser disagreement and full
interruption recovery.

### WS-3 — Secure update metadata

Owner: #24 Track C. Binding proposal: ADR-009.

Deliverables:

- project POUF pinned to TUF v1.0.35;
- root/targets/delegation/snapshot/timestamp fixtures;
- offline update bundle and disabled-update mode;
- rollback/freeze/mix-and-match/threshold/key-loss/revocation corpus;
- atomic metadata and package state transition.

Gate G3: zero rollback, freeze, mix-and-match, wrong-target, namespace crossover or
unauthorized capability expansion.

### WS-4 — Runtime compatibility and T2 boundary

Owner issue: #23. Binding protocol: ADR-006.

Deliverables:

- exact Electron baseline and patch policy;
- CEF exit criteria and comparison only when triggered;
- no Node/preload/raw IPC/native bridge in content;
- one package per process tree and ephemeral profile;
- default-deny permission, navigation, popup, download and external protocol policy;
- browser E2E compatibility and resource measurements.

Gate G4-T2: curated signed package runs with bounded persistence and no native bridge.

### WS-5 — T3 outer isolation

Deliverables:

- Linux namespace/container/VM experiment;
- OS-enforced no-network policy active before untrusted bytes;
- CPU/RAM/PID/FD/disk/wall-clock limits;
- read-only content-addressed package mount;
- independent process-tree, socket, DNS and persistence observation;
- hostile corpus and evidence envelope.

Gate G5-T3: no external flow, DNS lookup, host loopback access, ungated child process
or persistence artifact; independent review required. Chromium/Electron sandboxing
alone cannot pass.

### WS-6 — Publisher and capability governance

Owner issue: #25.

Deliverables:

- publisher admission and namespace ownership;
- declarative versioned capability grants;
- package/version/evidence-bound consent;
- revocation, emergency removal, support expiry and re-review;
- capability-expansion re-consent.

Gate G6: signature validity never implies admission, safety or capability authority.

### WS-7 — Verification, privacy, accessibility and release

Owner issues: #5, #6 and #11.

Deliverables:

- hostile package/updater/browser corpora;
- privacy sink/canary tests and implementation-derived data flow;
- keyboard, assistive-technology and WCAG-oriented critical flow;
- reproducible signed release and independent digest comparison;
- staging, rollback, incident, key-loss and vulnerability exercises;
- public support, privacy and accessibility documentation.

Gate G7: no P0 or unowned P1; all release and recovery evidence bound to the exact
artifact.

## 6. Measurement contract

Report per candidate and trust class:

- valid-case precision and malicious-case recall;
- differential disagreement count;
- crash/hang/OOM count per corpus/fuzz run;
- p50/p95 latency and peak memory;
- successful recoveries / injected interruptions;
- accepted rollback/freeze/mix-and-match/wrong-target attacks;
- accepted unauthorized key/namespace/capability transitions;
- external flows, DNS, loopback and persistent artifacts.

Any accepted malicious package, unauthorized state transition, verifier memory-safety
failure, unrecoverable interruption or T3 egress is a hard veto.

## 7. Release statement

The project remains pre-runtime and pre-production. Current evidence supports static
policy and the CWAP canonical-manifest subset only. Release requires applicable
G1–G7 gates and explicit owner approval.
