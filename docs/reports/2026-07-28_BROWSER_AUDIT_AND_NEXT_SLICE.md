# Browser Audit and Next Slice — 2026-07-28

- Repository: `marcohost33-maker/browser`
- Scope: repository, open issues, 0Meta/007 handoff evidence and current primary sources
- Result: continue, but narrow the next implementation to package/update/runtime evidence
- Production verdict: **not production-ready; no runtime exists**

## Executive finding

The project is stronger than a normal scaffold in static security, evidence and
canonical-manifest work. It is weaker than its document volume suggests in product
execution: there is no installer, verifier, updater or runtime host. The critical
risk is documentation and architecture drift causing implementation to follow a
superseded MCP-client sequence or to treat one accepted subcomponent as a complete
security boundary.

## Verified strengths

- standalone repository and trust-class reframe landed;
- static CSP/header/origin policy has a substantial negative regression suite;
- supply-chain and evidence controls are unusually explicit for a pre-runtime repo;
- branch/review foundation gates for the static-security work are completed;
- CWAP-Strict-JSON Track-B manifest core was promoted with differential and external-oracle evidence;
- package, update and runtime issues distinguish integrity, admission, capability,
  update and code-safety questions.

## Material gaps found

### P0 — Canonical status drift

README and implementation/roadmap documents still named merged or closed legacy
gates as future work and retained the old MCP/ENG-01 execution order. This could
misdirect implementation and invalidated the docs as a reliable source of truth.

### P0 — No executable product path

The repository has executable policy code, not a browser runtime. No current test
proves safe execution of foreign applications, package extraction, update freshness,
publisher governance or deployed privacy.

### P0 — Track-B overread risk

Promotion of deterministic manifest canonicalization can be misread as promotion of
ADR-007 or issue #24. Container, signed-byte scope, signature verification,
activation and Track-C update security remain open.

### P0 — T3 trust-boundary overclaim risk

Electron/CEF/Chromium sandbox controls are necessary but not a sufficient claim for
arbitrary hostile content. T3 needs a separately enforced OS/container/VM boundary,
OS-level null-egress, resource limits and independent observation.

### P1 — ADR identity collision

Two files used ADR-007 as their document identity. This made references ambiguous
and no automated repository gate detected the collision.

### P1 — Update design remained a checklist

Issue #24 correctly named TUF, but the repository lacked one pinned Track-C ADR with
an explicit offline profile, client-state invariants and acceptance matrix.

## Changes in this slice

- corrected README, implementation status, roadmap and decision register;
- consolidated ADR-007 around the actual partial decision;
- replaced the colliding amendment with ADR-007a;
- added ADR-009 for a pinned TUF v1.0.35 evaluation;
- implemented an initial dependency-free TUF offline metadata verifier and 14-case
  adversarial test matrix;
- added an executable ADR identity/link governance check and regression tests;
- wired the governance check into the local verification chain;
- recorded the next bounded execution sequence.

## Recommended implementation order

1. **Complete the TUF spike:** add raw-byte parsing, delegated publishers,
   independent differential evidence and atomic durable state/activation recovery.
2. **Container decision spike:** compare Track-A and project-controlled candidates
   on the same corpus; do not build a UI first.
3. **Package verifier:** implement only after exact signed bytes and container are
   fixed; output a deterministic decision record.
4. **Atomic installer:** content-addressed staging, same-volume activation,
   interruption recovery and last-good rollback.
5. **Electron compatibility harness:** curated signed content, no native bridge,
   ephemeral per-package storage and full deny handlers.
6. **Outer T3 Linux experiment:** network namespace/VM, cgroup limits, read-only
   package mount and independently observed null-egress.
7. **Publisher/capability governance:** no T2 admission before issue #25 evidence.

## Measurement contract for the next slice

At minimum report:

- malicious-case recall and valid-case precision;
- differential disagreement count;
- crashes, hangs and OOM events per fuzz case;
- p50/p95 verification latency and peak memory by package size;
- successful recoveries divided by injected interruptions;
- accepted rollback/freeze/mix-and-match/wrong-target attacks (target: zero);
- accepted unauthorized key, namespace or capability expansion (target: zero);
- T3 external flows, DNS lookups, loopback access and persistent artifacts (target: zero).

## Residual risk

This slice improves correctness of the repository and specifies the next security
boundaries. It does not implement or certify the product. The highest remaining risk
is attempting to combine package verification, updater and runtime in one large
implementation before each contract has its own corpus and evidence gate.
