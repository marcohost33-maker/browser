# ADR-007 — Signed Offline Package Evaluation

- Status: PROPOSED
- Date: 2026-07-14
- Depends on: ADR-005
- Decision owner: Marco

This ADR remains PROPOSED: it defines the two-track verifier spike and does not
select a package format. ADR-005 (ACCEPTED) makes T3 (arbitrary foreign content)
the target state; because foreign publishers then need verifiable provenance, the
`.swbn`/IWA track (Track A) gains weight relative to the T1-oriented minimal
manifest (Track B). Both tracks remain in the spike; nothing is decided here.

## Correction of prior recommendations

Two premature conclusions are rejected:

1. `.swbn`/IWA is not automatically the product's v1 format merely because it is
   the strongest current reference model.
2. A new project-specific ZIP format is not automatically simpler or safer; it
   creates a new parser, canonicalisation, key-rotation and update ecosystem.

The decision is therefore a measured two-track verifier spike.

## Track A — Signed Web Bundle / IWA compatibility

Evaluate:

- parsing the Web Bundle and integrity block;
- Ed25519 and ECDSA P-256 verification;
- deterministic extraction or resource serving;
- bundle identity derivation;
- duplicate resource and canonical URL handling;
- malformed CBOR, oversized lengths and decompression/resource limits;
- update continuity and signing-key loss/rotation behaviour;
- availability and maintenance of Go, Node and experimental Rust tooling.

Important boundaries:

- `.swbn` is signed, not encrypted; the runtime verifies and serves resources.
- Using `app://` does not reproduce the browser-enforced `isolated-app://` origin,
  storage, CSP, cross-origin isolation or permission semantics.
- A custom host must explicitly implement every guarantee it claims.
- IWA's initial product availability remains managed-ChromeOS/selected-partner
  oriented; interoperability value does not equal cross-platform consumer
  readiness.

### Concrete standard-candidate detail (2026, `[extern]`)

The concrete reference format to evaluate under Track A is the **Signed Web Bundle
(`.swbn`)** as consumed by **Isolated Web Apps (IWA)**:

- **Integrity Block V2 is the active format.** V1 is **deprecated since Chrome
  M129** (installing a V1-signed bundle errors with *"Integrity Block V1 has been
  deprecated since M129. Please re-sign your bundle."*); V2 was introduced to fix
  key-rotation limitations of V1, and both were supported for a migration window
  before V1 support is dropped `[extern: chromium IWA docs / WICG isolated-web-apps]`.
  Any browser-side verifier we build must target **V2**.
- **Signature algorithms:** the integrity block carries one or more signatures;
  **Ed25519** (V1's algorithm) and **ECDSA P-256** are the elliptic-curve schemes in
  scope for V2 `[extern — confirm the exact V2 algorithm set + count/order rules
  against the current WICG spec before implementing; do not hardcode from memory]`.
- **Identity is key-derived, not archive-bytes-derived** — the bundle identity is
  derived from the signing public key, which is what makes key rotation a first-class
  concern (the V1→V2 motivation).

**Weighing vs Track B (minimal manifest).** `.swbn`/IWA is the stronger reference
model (spec, real consumer, integrity-block + rotation story) and gains weight under
the ADR-005 T3 target where foreign publishers need verifiable provenance. Its cost:
a CBOR/web-bundle parser, integrity-block V2 verification, and the honest boundary
that a **custom `app://` host does not reproduce Chrome's browser-enforced
`isolated-app://` origin/storage/CSP/permission semantics** — every guarantee must be
re-implemented and re-audited, not inherited. The minimal manifest (Track B) avoids
the web-bundle parser but creates a **new** format, canonicalisation, rotation and
update ecosystem to specify and fuzz. Neither is selected here; both stay in the
two-track spike.

## Track B — Minimal manifest-root package

Prototype only as a comparison baseline. Requirements:

- archive bytes are not the identity;
- one canonical manifest representation;
- every payload path, size, media type and digest is bound by the signature;
- standard cryptography only;
- unknown critical fields fail closed;
- path traversal, absolute paths, symlinks, device files, duplicate paths,
  Unicode/case collisions and undeclared files are rejected;
- resource, file-count and compression limits are enforced before extraction;
- publisher trust, revocation, key rotation, downgrade prevention and rollback are
  specified independently of signature verification.

## Test corpus

Both tracks must consume the same adversarial corpus:

- valid package and valid update;
- modified payload after signing;
- modified manifest;
- duplicate/colliding paths;
- `..`, absolute, UNC and reserved Windows paths;
- Unicode normalization and case-fold collisions;
- truncated and oversized structures;
- unsupported algorithms and versions;
- old-version replay and unauthorized signing key;
- permission expansion without explicit approval;
- interrupted installation and rollback.

## Decision criteria

Prefer `.swbn` if the chosen runtime can verify and serve it with a maintained,
auditable implementation and without falsely claiming Chrome's IWA enforcement.
Prefer a minimal format only if the `.swbn` path creates materially greater
complexity and the new format's specification, parser, fuzz corpus, rotation and
update model can be independently audited.

No format is accepted before the spike. The label "de-facto standard" is not a
substitute for supported consumer implementations and maintained verifier code.

## Deliverables

- [ ] exact parser/verifier dependencies and licenses
- [ ] conformance and fuzz results
- [ ] package identity and publisher trust policy
- [ ] update, rollback, revocation and key-rotation model
- [ ] resource-limit policy
- [ ] independent security review
