# ADR-007 — Signed Offline Package Evaluation

- Status: PROPOSED
- Date: 2026-07-14
- Depends on: ADR-005
- Decision owner: Marco

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
