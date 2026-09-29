# `browser` — Implementation Status

- Updated: 2026-09-29
- Repository: `marcohost33-maker/browser`
- Product: standalone native, offline-capable web-application runtime
- Delivery: T1 owner-controlled → T2 curated third-party → T3 arbitrary foreign content
- First release scope: T1
- Overall state: **security/evidence foundation plus manifest/update spikes; no runtime product**

## Executive status

The repository has a strong static security, documentation and supply-chain
foundation, but it does not yet install or execute an application. The main risk is
not low-level CSP implementation; it is crossing from specification into a real
package-verification, update and runtime boundary without collapsing distinct trust
decisions.

The canonical-manifest subset of ADR-007 Track B was promoted on 2026-07-22 as
`CWAP-Strict-JSON v0.1.2`. This proves deterministic manifest representation over
its accepted domain. It does not prove package integrity, publisher admission,
capability approval, secure updates, safe extraction or runtime isolation.

## Effective decisions

| Area | State | Effective position |
|---|---|---|
| Repository boundary | ACCEPTED | `browser` is standalone; `nigin-engine` and `browser-nigin` are not dependencies |
| Trust classes | ACCEPTED | staged T1 → T2 → T3, with T3 as north star and T1 as first release |
| MCP | ACCEPTED | internal, optional and off the T1 critical path |
| Manifest canonicalization | ACCEPTED PART | CWAP-Strict-JSON v0.1.2 Track-B core promoted |
| Package format | OPEN | no `.swbn`, NAR, ZIP or other container selected |
| Secure update | OPEN | TUF-style evaluation specified in ADR-009; no updater implemented |
| Runtime | OPEN | Electron is the pragmatic compatibility/harness baseline; no production runtime selected |
| T3 boundary | OPEN / FAIL-CLOSED | outer OS/container/VM isolation and null-egress evidence required |
| Publisher/capability governance | OPEN | issue #25 |
| Product evidence | OPEN | issue #14 |

## Implemented and verified

### Static policy enforcement

- machine-readable CSP/security-header baseline;
- independent exact directive/value contract;
- exact-origin network-source validation;
- HTTPS remote origins and explicit loopback-only HTTP development origins;
- rejection of private, reserved, malformed and noncanonical address/origin forms;
- strict HSTS, referrer, permissions, MIME, opener, embedder, resource and framing policies;
- final-response protected-header readback;
- negative regression tests for injection, casing, duplicates, downgrade and mutation;
- source-level prevention of application use of raw security primitives.

### Supply-chain and evidence foundation

- exact Node/npm policy and deterministic lockfile checks;
- lifecycle scripts disabled for dependency installation;
- vulnerability snapshot and high/critical gate;
- SPDX SBOM and evidence-manifest workflows;
- SHA-pinned, least-privilege GitHub Actions;
- local CI-parity verification for required offline checks;
- protected-main and independent-review foundation gates completed for the prior
  static-security promotion.

### Package-manifest spike

- Python, Rust and JavaScript CWAP implementations;
- differential and external-oracle evidence;
- fixed canonical subset profile with floats forbidden and safe-integer limits;
- deterministic reject precedence and owner-promoted Track-B manifest specification.

### Initial secure-update spike

- dependency-free Node.js verifier for a self-contained TUF v1.0.35 offline bundle;
- top-level root, timestamp, snapshot and targets threshold verification;
- old/new root dual-threshold rotation and correct timestamp/snapshot fast-forward reset;
- preservation of separately trusted targets rollback state across key rotation;
- rollback, freeze, mix-and-match, target-integrity and capability-expansion checks;
- canonical JSON depth/node bounds, cycle rejection, canonical UTC expiry and full
  signed-target path validation;
- immutable bytes/capability identity for a reused application version;
- 20 deterministic TUF tests plus four ADR-governance tests, all locally green.

### Activation-store spike (ADR-007a section 6)

- format-neutral content-addressed object store; package paths are keys only and never
  touch the filesystem;
- one atomic commit point (`state/CURRENT`), compare-and-swap generations, verified
  last-good retention bound to the commit record, deterministic rollback;
- commit-level bindings that move update metadata atomically with the active version;
- commits that re-establish their own object-directory barriers and complete the
  `durable_rename` sequence (file sync under the new name, then directory sync), so
  a platform without directory flush still gets a barrier and reports which one held;
- fail-closed recovery that re-establishes durability barriers and never switches
  versions on its own; streamed verification; root-ownership check;
- two serving primitives: `readResource` (small resources, bytes re-hashed) and
  `openResource` (large resources: whole-object verification through one handle,
  then a chunked stream from that same handle); validated version records are cached
  for serving only;
- ADR-007a section 9 benchmark (`bench.mjs`): p50/p95 latency of stage, activate,
  verify, read, open/stream and recover plus peak memory across six package shapes
  along the resource envelope, run per platform in CI with the report kept as an
  artifact;
- crash matrix over process-crash, posix-strict and ordered-prefix persistence models
  in three platform variants (POSIX, NTFS journal hypothesis, no barrier):
  58,078/58,078 crash cases consistent, 0 durability violations, 4/4 negative
  controls detected, 312/312 real-filesystem process crashes on Linux;
- 19/19 control mutations killed; evidence report bound to exact source digests;
- `activation-store-ci` workflow: tests, platform probe and the real-filesystem
  process-crash matrix on Windows and macOS (advisory, path-filtered).

Not wired to any verifier, installer or runtime. See `spike/activation-store/README.md`.

## Not implemented

- native application shell or Chromium host;
- package parser/verifier and signature validation wired to a product path;
- installer wiring of the activation-store spike, power-loss evidence on Windows and
  macOS (the NTFS journal-barrier hypothesis is modelled, not measured) and a real
  power-loss drill;
- production TUF client/repository, raw-byte parser, delegations, durable monotonic
  state, revocation operations or atomic offline update activation;
- publisher admission, namespace ownership and capability approval engine;
- per-application process, profile, storage and permission isolation;
- OS-enforced null-egress and independent process-tree/network observation;
- hostile-content browser E2E, renderer-compromise or sandbox-escape exercises;
- production privacy notice, accessibility statement, support, rollback and incident drills;
- reproducible signed release artifacts.

## Current P0/P1 gaps

1. **Product falsifiability (#14):** primary user, anti-persona, top task and go/pivot/stop criteria.
2. **Acquisition semantics (#30):** distinguish signed package, installed PWA, captured archive and remote browsing.
3. **Package completion (#24):** container, signed-byte scope, strict crypto, resource limits, extraction and activation evidence.
4. **Update security (#24 / ADR-009):** raw-byte parser, delegated publishers,
   durable monotonic state, revocation, independent differential evidence and
   atomic metadata/package recovery.
5. **Runtime evidence (#23):** exact Electron/CEF versions, sandbox configuration, compatibility and patch-SLA measurements.
6. **T3 isolation:** outer sandbox/VM profile, OS-level deny, resource limits and independently observed null-egress.
7. **T2 governance (#25):** publisher admission, capability approval, emergency removal and support lifecycle.
8. **Release operations (#6):** incident, revocation, rollback, privacy and vulnerability handling.

## Next execution slice

The next implementation should be small and evidence-producing:

1. keep the repository/document consistency gate required;
2. freeze the T1 package/update interface without selecting a container prematurely;
3. extend the initial TUF harness with raw parsing, delegated publishers,
   differential evidence and atomic persistence/activation;
4. implement the package verifier only after the exact container/signed-byte decision;
5. build an Electron compatibility harness with no native bridge and an outer
   Linux null-egress experiment;
6. admit no third-party package and make no T3 claim before independent security evidence.

## Production-readiness statement

`browser` is not production-ready and is not a functioning browser runtime. The
current evidence supports claims about static policy enforcement, the accepted CWAP
manifest subset and the bounded in-memory TUF spike only. It does not support
claims that foreign content is safely executed, updates are secure or user data is
protected in a deployed product.
