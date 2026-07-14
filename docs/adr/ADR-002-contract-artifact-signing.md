# ADR-002 — Contract Artifact Signature and Provenance

- Status: ACCEPTED TARGET DESIGN (product framing realigned 2026-07-14)
- Decision date: 2026-07-10
- Revalidated: 2026-07-11
- Realigned: 2026-07-14
- Implementation: BLOCKED on `nigin-engine` contract publication
- Scope: how `browser` establishes trust in the `nigin-engine` contract artifact

> **Framing realignment (2026-07-14).** The signature/SLSA-provenance/immutable-pin
> substance of this ADR is retained and unchanged — it is the correct trust model
> for consuming any signed engine contract artifact. Only the product framing is
> realigned to the 2026-07-14 reframe (ADR-005/006/007, PR #22): the contract
> producer is `nigin-engine` (the contract core of the three-layer stack `browser`
> runtime · `nigin-engine` core · `browser-nigin` AI layer). Read "MCP contract"
> below as "the signed, versioned `nigin-engine` contract artifact". The same
> signature verification, provenance and digest-lock discipline also governs the
> signed offline app packages evaluated under ADR-007.

## Context

APP-01 consumes schemas, generated types, fixtures and conformance expectations
from ENG-01. A digest can detect a changed artifact relative to a trusted
reference, but a digest supplied alongside a malicious artifact does not prove
who produced it or how it was built.

Production contract input therefore requires integrity, producer identity,
build provenance and an immutable reviewed pin.

## Decision

ENG-01 production contract artifacts must be distributed with:

1. a cryptographic signature bound to the expected GitHub Actions workload
   identity;
2. a verification bundle containing the certificate and transparency-log
   evidence;
3. SLSA provenance identifying source, revision, builder and build invocation;
4. a digest recorded in APP-01's reviewed contract lock;
5. versioned schemas, fixtures and compatibility metadata.

APP-01 verifies all evidence before code generation, fixture use or runtime
integration. Any failure blocks the build.

The selected mechanism is Sigstore keyless signing with `cosign` plus SLSA
provenance. Long-lived signing keys are not introduced into either repository.

## Producer requirements for ENG-01

ENG-01 should:

1. build the contract artifact in a protected release workflow;
2. use GitHub Actions OIDC to obtain short-lived signing identity;
3. sign the artifact and publish a Sigstore bundle;
4. emit SLSA provenance naming the source repository, commit/tag, builder and
   entry point;
5. publish artifact, bundle, provenance, digest and compatibility metadata as
   one immutable release set;
6. retain the release workflow and action pins needed to reproduce and audit the
   build.

These are cross-repository requirements, not implementation owned by APP-01.

## Consumer verification in APP-01

A future contract-update workflow must verify:

### Signature identity

The certificate identity must match the specifically approved ENG-01 release
workflow and tag/ref policy. Avoid a broad regular expression that allows any
workflow file.

Illustrative shape only—the exact workflow path is pinned when ENG-01 publishes
it:

```bash
cosign verify-blob \
  --certificate-identity \
    'https://github.com/marcohost33-maker/nigin-engine/.github/workflows/release-contract.yml@refs/tags/<tag>' \
  --certificate-oidc-issuer \
    'https://token.actions.githubusercontent.com' \
  --bundle mcp-contract.sigstore.json \
  mcp-contract.tar.gz
```

### Provenance

The attestation must identify:

- `marcohost33-maker/nigin-engine` as source;
- the reviewed tag and source commit;
- the accepted builder/workflow identity;
- the expected subject digest;
- the expected build entry point and artifact name.

Verification uses an official SLSA verifier or equivalent policy-enforcing
attestation verifier pinned by version and digest.

### Digest lock

After signature and provenance verification, the artifact digest must equal the
value in APP-01's reviewed contract lock. The lock also records:

- contract version and MCP revision;
- artifact URL/release identifier;
- digest algorithm and value;
- signature identity and OIDC issuer;
- provenance predicate type;
- retrieval and verification time;
- compatibility and expiry/review date.

### Safe extraction and generation

Before consuming an archive:

- reject absolute paths, `..` traversal, device files and unexpected symlinks;
- enforce file-count and uncompressed-size limits;
- require an explicit manifest allowlist;
- generate into a clean temporary directory;
- compare generated output deterministically;
- do not execute lifecycle scripts or code from the artifact.

## Failure behavior

Verification fails closed on:

- absent or invalid signature/bundle;
- unexpected workflow identity or issuer;
- missing transparency evidence when required by the bundle profile;
- source, tag, builder or subject mismatch;
- digest mismatch;
- expired or revoked trust policy;
- unsafe archive content;
- non-deterministic generated output;
- incompatible contract or MCP revision.

A hash-only or manually copied artifact may be used for isolated mock research
only. It cannot become a production build input.

## Trust-policy change control

Changes to producer identity, issuer, source repository, workflow path,
provenance predicate, verifier or contract lock are security-sensitive and
require code-owner review plus passing negative tests.

Trust roots and identity expressions are configuration under review, not values
accepted from the downloaded artifact.

## Verification tests required before implementation completes

- valid signed artifact passes;
- artifact modified after signing fails;
- valid signature from the wrong workflow/repository fails;
- valid signature with wrong provenance subject fails;
- digest-lock mismatch fails;
- missing bundle/provenance fails;
- path traversal, symlink and archive-bomb fixtures fail;
- regenerated output matches the committed/published digest;
- verifier unavailability fails without silently accepting the artifact.

## Consequences

- Runtime MCP work remains blocked until ENG-01 publishes the required release
  set and APP-01 implements this verifier.
- Contract updates become explicit reviewed supply-chain events.
- APP-01 gains stronger provenance than digest-only pinning, but the control is
  only effective when branch/release protection and identity policy are also
  enforced.

## Primary sources

- Sigstore cosign blob signing and bundle creation:
  `https://docs.sigstore.dev/cosign/signing/signing_with_blobs/`
- Sigstore verification:
  `https://docs.sigstore.dev/cosign/verifying/verify/`
- GitHub Actions OIDC security hardening:
  `https://docs.github.com/en/actions/concepts/security/openid-connect`
- SLSA Provenance v1.2:
  `https://slsa.dev/spec/v1.2/provenance`
- SLSA verification summary:
  `https://slsa.dev/spec/v1.2/verifying-artifacts`
