# ADR-007a — Signed-Package Verifier and Activation Hardening

- Status: PROPOSED normative requirements; implementation incomplete
- Date: 2026-07-28
- Parent: ADR-007
- Supersedes: `ADR-007-amendment-cross-family-verifier-hardening-2026-07-16.md`
- Related: ADR-009 and issue #24

## Purpose

This sub-ADR consolidates the effective package-verifier requirements after the
cross-family reviews and subsequent corrections. It removes layered historical
wording that contained superseded claims and gives one implementation target.

The accepted CWAP canonical-manifest core satisfies only the manifest-serialization
part of this document.

## 1. Input and resource envelope

The verifier must reject before unbounded allocation or extraction when any pinned
limit is exceeded. Limits are versioned policy, not implementation defaults.

At minimum pin and test:

- total package bytes;
- manifest bytes before parsing;
- entry/resource count;
- per-entry and aggregate uncompressed bytes;
- compression ratio and streamed output ceiling;
- JSON and container nesting/depth;
- path length and component count;
- verification wall-clock, CPU and memory budget.

Every abort must produce a deterministic machine-readable reason and leave no active
or partially trusted installation.

## 2. Canonical manifest

The on-wire manifest must:

- be valid UTF-8 with no BOM, NUL, duplicate object keys or lone surrogates;
- be byte-identical to its own accepted CWAP/JCS-subset canonical output;
- use UTF-16 code-unit key ordering;
- reject floats, NaN and Infinity;
- restrict integers to the accepted safe range;
- reject unknown root fields and bind all extension fields;
- carry exact schema, package, app, version, capability and algorithm identifiers;
- list every payload resource exactly once with path, media type, size and digest.

The verifier signs and verifies the exact on-wire canonical bytes. It must not parse,
re-canonicalize and then trust different bytes.

## 3. Cryptographic binding

The package never chooses its own cryptographic policy. The verifier hardcodes the
allowed signature and hash algorithms for each schema version and rejects missing,
unknown or downgraded values.

The signed region must bind:

- schema and package-format version;
- app/package identity and release version;
- publisher key identifier and namespace;
- every payload path, media type, size and content digest;
- representation properties needed to prevent a compression/bomb swap;
- declared capabilities and update-relevant metadata;
- the complete extension set.

Use strict, version-pinned signature verification and reject noncanonical or
small-order key/signature encodings according to the selected library's documented
strong-binding mode. Signature verification occurs before payload parsing or
extraction beyond bounded framing needed to locate the signed region.

## 4. Container requirements

Prefer a small canonical single-pass grammar when the runtime controls both writer
and reader. Any selected container must have one unambiguous resource identity and
ordering model.

When ZIP is evaluated or used, the accepted profile must reject at least:

- comments, encryption, multi-disk, data descriptors and prepended/trailing data;
- ZIP64 records and sentinel values;
- unsupported compression methods;
- Central Directory versus Local Header disagreement in names, sizes, CRC,
  compression method or flags;
- orphan, shadow, overlapping or stacked local entries;
- filename-bearing extra fields or conflicting filename sources;
- duplicate, normalized, case-fold or confusable path collisions;
- absolute, traversal, UNC, device, ADS, reserved-name and trailing-dot/space paths;
- symlinks, reparse points and unsafe POSIX mode bits;
- integer-overflow, excessive-count, aggregate-size and decompression-bomb cases.

A ZIP acceptance set must be a strict subset on which all pinned independent parsers
agree on names, order and bytes. No single archive library is a correctness oracle.

When NAR or another canonical archive is evaluated, it receives the same malformed,
resource-exhaustion, path, identity and differential corpus. "Simpler by design" is
a hypothesis until measured.

## 5. Manifest and payload bijection

The verifier must prove both directions:

- every signed manifest resource exists exactly once in the container;
- every container resource is declared exactly once in the signed manifest.

Content hashes alone are insufficient when the representation can be swapped into a
resource-exhaustion form. Bind the relevant representation metadata or the complete
canonical container digest.

## 6. Filesystem and activation

Verification and extraction run out of process with explicit CPU, memory, file-count,
byte and time limits.

Installation must:

- stage into a newly created, exclusively owned directory on the same filesystem as
  the activation root;
- open path components with symlink/reparse-point failing semantics;
- verify containment on opened handles/descriptors, not only strings;
- never write through a pre-existing symlink, junction or reparse point;
- normalize permissions and timestamps rather than trusting archive metadata;
- write immutable content-addressed payloads;
- atomically switch the active version only after all verification succeeds;
- retain a bounded last-good version and support deterministic rollback;
- recover cleanly from power loss and interruption at every state transition.

## 7. Identity, admission and capabilities

The signed app-id is bound to one or more explicitly authorized publisher keys.
A valid signature from another key is rejected for that app-id unless a separately
verified rotation/admission record authorizes it.

Capability grants are declarative, versioned and package-bound. An update that adds
or widens capabilities requires explicit re-consent. Signature validity never grants
a capability.

## 8. Update boundary

Freshness, repository consistency, delegation, revocation and key recovery are not
implemented inside the package signature. ADR-009 owns the TUF-style metadata model.
The installer accepts an update only when package verification **and** update
metadata verification independently pass.

## 9. Evidence and acceptance

Required evidence:

- versioned and hashed adversarial corpus;
- independent implementation differential tests;
- property-based and coverage-guided fuzzing;
- parser/verifier dependency and advisory review;
- p50/p95 verification time and peak memory by package size;
- injected interruption recovery matrix;
- key rotation, revocation and namespace crossover tests;
- capability-escalation and rollback/freeze/mix-and-match tests;
- machine-readable decision record binding input digest, verifier versions, policy,
  result and reasons;
- independent security review of the exact candidate.

Hard vetoes are any accepted malicious package, verifier crash/hang/OOM, parser
verdict disagreement on the accepted set, unauthorized namespace/key, rollback,
freeze bypass, capability escalation or incomplete recovery.
