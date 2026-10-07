# ADR-009 — TUF-Based Secure Update Metadata Evaluation

- Status: PROPOSED
- Date: 2026-07-28
- Parent workstream: ADR-007 Track C / issue #24
- Reference specification: The Update Framework v1.0.35, modified 2026-07-15
- Decision owner: Marco

## Context

Package signatures provide package authenticity and integrity. They do not prevent
an attacker or stale mirror from serving an old but valid package, mixing metadata
from incompatible repository states, freezing clients on stale metadata or abusing
an online signing key beyond its intended role.

`browser` also requires a first-class offline mode. Manual offline sideload is
mandatory; automatic update is optional and fully disableable. A design that assumes
continuous connectivity or a trustworthy wall clock is therefore insufficient.

## Proposal

Evaluate TUF v1.0.35 as the update-metadata security model while keeping the package
format independent. The spike must define a project-specific POUF that pins:

- metadata serialization and canonicalization;
- supported key types and signature schemes;
- role names, thresholds, expiry policy and delegation layout;
- repository and offline-bundle layout;
- package/app identity mapping;
- client persistent state and recovery rules;
- size, count and time limits;
- error and audit-record vocabulary.

No TUF library or custom implementation is selected by this ADR.

## Required role model

### Root

- shipped as the initial trust anchor;
- threshold-signed with offline keys;
- authorizes keys and thresholds for every top-level role;
- rotated sequentially with version checks;
- supports documented out-of-band recovery for threshold compromise or loss.

### Targets and delegations

- describe package target path, length and digest;
- bind target metadata to app/package identity and trust class;
- delegate narrowly by publisher namespace or product line;
- allow revocation without resigning unrelated publisher targets;
- do not encode runtime capability approval as an implicit consequence of target trust.

### Snapshot

- binds the versions and hashes of targets/delegated metadata;
- prevents mix-and-match repository states;
- is checked for monotonic version progression and bounded size.

### Timestamp

- binds the current snapshot version/hash and limits indefinite replay when a trusted
  clock is available;
- uses a short-lived online key with minimal authority;
- is treated as best-effort freshness in fully offline operation, not as a substitute
  for the client's monotonic trusted-version ledger.

## Offline profile

An offline update bundle must carry all metadata and targets needed for one atomic
update operation. The client verifies from its already trusted root and persisted
highest-seen versions before exposing target bytes to the installer.

Offline acceptance requires:

- no metadata or target version lower than trusted client state;
- a complete internally consistent snapshot;
- all signatures, thresholds, lengths and hashes valid;
- target identity matching the requested app/package;
- no capability escalation without explicit re-consent;
- no dependency on a network response or mutable external file;
- atomic persistence of new trusted metadata state with package activation;
- deterministic recovery if activation or trusted-state persistence is interrupted.

The disabled-update mode must remain operable indefinitely for manually installed
packages. Disabling updates must not disable package verification or rollback to the
last-good installed version.

## Threat and test matrix

The spike must demonstrate rejection or safe handling of:

- arbitrary target and wrong-target substitution;
- rollback of root, targets, delegated, snapshot or timestamp metadata;
- freeze/replay with valid but stale metadata;
- mix-and-match metadata from different repository states;
- fast-forward version exhaustion;
- endless metadata/target data and excessive delegations;
- threshold-minus-one signatures and unauthorized keys;
- compromised timestamp or snapshot key within its bounded role;
- revoked publisher delegation and namespace crossover;
- root, targets and publisher-key rotation;
- lost key, compromised threshold and out-of-band recovery;
- interrupted metadata persistence, package activation and rollback;
- offline bundle replay on a client with newer trusted state;
- capability expansion hidden in an otherwise valid update.

## Client state invariants

The client persists, atomically and per repository/app scope:

- trusted root version and root metadata digest;
- highest accepted metadata versions;
- currently active and last-good package identities/digests;
- approved capability set and consent version;
- last verification decision record.

The client must never advance trusted metadata state without also preserving a
recoverable installation state. It must never activate a package before both update
metadata and package verification pass.

## Initial implementation status — 2026-07-28

An executable, dependency-free Node.js spike now verifies a self-contained offline
bundle in memory for the top-level root, timestamp, snapshot and targets roles. It
implements unique-key threshold counting, old/new root dual-signature rotation,
correct timestamp/snapshot fast-forward recovery while preserving separately trusted
targets rollback state, metadata and target length/hash binding, rollback/freeze and
mix-and-match checks, app identity/version/capability binding, bounded canonical
JSON, canonical UTC expiry and validation of every signed target path. Twenty TUF
tests plus four ADR-governance tests pass locally.

This is partial evidence only. Delegated targets, networking, durable monotonic
state, atomic coupling to package activation, independent differential verification,
fuzzing and recovery drills remain blockers. See
`spike/tuf-offline-metadata/README.md`.

## Raw-byte ingress amendment — 2026-09-27

The candidate implementation now adds a strict raw-byte ingress before the in-memory
verifier. It rejects duplicate JSON object names before ordinary object construction,
uses fatal UTF-8 decoding, applies byte/depth/node resource limits during parsing and
retains the exact received bytes for metadata descriptor checks.

A review correction is normative for this candidate: **the complete metadata
envelope is not required to equal its canonical re-serialization.** The two byte
domains are kept separate:

- metadata signatures are verified over the project-POUF canonical serialization of
  the `signed` object;
- timestamp and snapshot `length`/`hashes` descriptors are checked against the
  exact bytes of the referenced metadata file as received.

Object-only verification remains available for deterministic research fixtures, but
must not be treated as the untrusted production ingress because re-serialization can
erase duplicate-key evidence and change descriptor bytes.

Upstream TUF v1.0.36 is current as of this amendment. This ADR deliberately remains
pinned to v1.0.35 until a separate specification-delta review determines whether the
project POUF should change.

## Coupled persistence amendment — 2026-10-07

The persistence-model question (role-by-role files versus one compare-and-swap
generation with a single atomic pointer) now has measured evidence for the second
option: [`spike/update-activation/`](../../spike/update-activation/README.md).

- One offline update bundle is applied as **one** activation-store commit. That commit
  names the new package version and binds the exact bytes of root, timestamp, snapshot
  and targets plus an app trust state: identity, version, digest, approved capabilities
  and the decision record. This implements the client-state invariant above: trusted
  metadata never advances without the matching installation state, and a package is
  never activated before both metadata and package verification pass.
- Every load re-verifies the bound chain from its bytes, with signatures, thresholds and
  the version/length/hash pins, but **not** freshness. A disabled or offline client keeps
  starting after its metadata expired, while incoming bundles are still checked for
  expiry.
- Because a crash can only leave the old or the new commit, the two repair paths of the
  role-by-role client (the TUF 5.3.11 rotation reset on load and the resume from the
  trusted timestamp) are unnecessary. A bound chain that does not verify fails closed.
- A local rollback moves only the package. Metadata and every rollback floor stay bound.
- Evidence:
  - The model crash matrix over six scenarios, including a root rotation of the online
    keys: 64,931/64,931 consistent, 0 durability violations.
  - 329/329 real process crashes on ext4.
  - A two-commit negative control detected as mixed state in every variant.
  - 11/11 control mutations killed.

This is spike evidence for the deliverable "atomic metadata/package activation
interruption matrix", not its acceptance. A real power-loss drill, wiring the stateful
CLI onto this model, delegations and independent review remain open. The specification
delta to v1.0.36 is reviewed in
[`docs/research/2026-10-07_TUF_SPEC_1.0.35_TO_1.0.36_DELTA.md`](../research/2026-10-07_TUF_SPEC_1.0.35_TO_1.0.36_DELTA.md).
It is editorial only, and the pin stays a separate profile decision.

## Evaluation deliverables

- [ ] exact v1.0.35 clauses mapped to implementation requirements;
- [ ] project POUF and JSON schemas;
- [ ] generated root/targets/snapshot/timestamp fixtures;
- [ ] delegated publisher fixture and revocation fixture;
- [ ] offline update bundle format and limits;
- [ ] independent client implementations or differential oracle;
- [ ] complete adversarial matrix with deterministic results;
- [ ] key-rotation, threshold-loss and out-of-band recovery drill;
- [ ] atomic metadata/package activation interruption matrix;
- [ ] performance and peak-memory measurements;
- [ ] dependency, license and maintenance review;
- [ ] independent security review;
- [ ] owner acceptance/rejection with residual risks.

## Acceptance rule

TUF is selected only if the measured spike preserves the required offline UX and
passes every hard security invariant. A valid signature is insufficient. Any
accepted rollback, freeze bypass, mix-and-match state, wrong target, namespace
crossover, unauthorized capability expansion or unrecoverable interruption is a hard
veto.

## Primary references

- TUF Specification v1.0.35: <https://theupdateframework.github.io/specification/v1.0.35/>
- TUF project: <https://theupdateframework.io/>
