# ADR-002 — Contract Artifact Signing and Provenance (verify-before-trust)

- Status: PROPOSED
- Date: 2026-07-10
- Scope: how APP-01 `browser` establishes trust in the ENG-01 `nigin-engine`
  MCP contract artifact it consumes
- Supersedes: the "integrity identifier (hash)" language in
  `contracts/MCP_CONSUMER_PROFILE.md` (required input #2)

## Context

APP-01 consumes — never defines — the MCP contract from ENG-01 (schemas,
generated types, fixtures). ADR-001 and the MCP Consumer Profile require the
contract input to be *version-pinned*, and the threat model has a
"Supply-chain compromise" control and an "unpinned contract input" release
blocker.

The original profile asked ENG-01 for an "integrity identifier" (a hash). A
hash proves **integrity relative to a reference value** — it detects
corruption in transit. It does **not** prove **authenticity or provenance**:
an attacker who can influence what APP-01 pins can supply a malicious artifact
*and* its matching hash. Hash-pinning alone is not verify-before-trust.

## Decision

The ENG-01 contract artifact MUST be **cryptographically signed with build
provenance**, and APP-01's toolchain MUST **verify signature + provenance +
transparency-log inclusion before consuming it**. A bare digest is retained
as a secondary integrity check, not as the trust anchor.

Standard chosen: **Sigstore keyless signing (cosign)** for the signature and
**SLSA build provenance** for the "how it was built" attestation. Together:
provenance proves the build process was legitimate; the cosign signature
proves the artifact has not changed since provenance was generated
([AquilaX: Sigstore/SLSA beyond SBOMs](https://aquilax.ai/blog/supply-chain-artifact-signing-slsa),
confidence: medium;
[Sigstore verify docs](https://docs.sigstore.dev/cosign/verifying/verify/),
confidence: high). By 2026, signed artifacts with verifiable provenance are
treated as a supply-chain baseline (SLSA L2+; CISA guidance)
([OpenSSF/Sigstore](https://openssf.org/blog/2024/02/16/scaling-up-supply-chain-security-implementing-sigstore-for-seamless-container-image-signing/),
confidence: medium).

### Producer side (ENG-01 responsibility — stated as a requirement, not owned here)

1. Build the contract artifact deterministically in ENG-01 CI (tagged release).
2. Sign it **keyless**: the GitHub Actions OIDC identity authenticates to the
   Fulcio CA, which issues a short-lived certificate; cosign signs the
   artifact; the signing event is recorded in the Rekor transparency log
   ([Sigstore keyless](https://www.systemshardening.com/articles/cicd/sigstore-keyless-signing/),
   confidence: high). No long-lived private key to leak.
3. Emit **SLSA provenance** (build attestation) naming the builder, the source
   repo (`marcohost33-maker/nigin-engine`), the commit/tag, and the build
   entry point.
4. Publish: the artifact, its `.sigstore` bundle (cert + signature + Rekor
   inclusion proof), the SLSA provenance attestation, and the digest.

### Consumer side (APP-01 responsibility — verify before trust)

APP-01's dependency-update / CI step verifies **all** of the following before
the contract version is allowed into the build; any failure fails closed:

1. **Signature + identity** — the artifact is signed by the expected ENG-01
   release workflow identity and OIDC issuer:

   ```bash
   cosign verify-blob \
     --certificate-identity-regexp \
       '^https://github.com/marcohost33-maker/nigin-engine/\.github/workflows/.+@refs/tags/.+$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     --bundle mcp-contract.sigstore.json \
     mcp-contract.tar.gz
   ```

2. **Provenance** — the SLSA attestation matches expected source and builder:

   ```bash
   slsa-verifier verify-artifact mcp-contract.tar.gz \
     --provenance-path mcp-contract.intoto.jsonl \
     --source-uri github.com/marcohost33-maker/nigin-engine \
     --source-tag "$PINNED_CONTRACT_TAG"
   ```

   (Equivalent: `cosign verify-attestation --type slsaprovenance ...`.)

3. **Transparency-log inclusion** — Rekor inclusion proof in the bundle is
   valid (verified as part of `cosign verify-blob`).

4. **Digest pin** — the verified artifact's digest equals the digest recorded
   in APP-01's contract lockfile (secondary integrity check).

Only after 1–4 succeed may generated types/fixtures be regenerated from the
artifact. Verification identity strings (`certificate-identity-regexp`,
`source-uri`, pinned tag) live in APP-01 config and are themselves reviewed on
change.

## Consequences

- APP-01 gains verify-before-trust against ENG-01 (threat-model
  "Supply-chain compromise" control strengthened from "provenance/SBOM" to
  "signature + SLSA provenance + transparency-log verification").
- Hard dependency: **ENG-01 must publish signed, provenanced artifacts.**
  Until it does, APP-01 has no runtime MCP code (per Gate M1A) and MUST treat
  any hash-only artifact as **unverified provenance**: usable for local
  development against mocks only, never as a production trust anchor. This is
  recorded as an open cross-repo dependency, not silently accepted.
- Verification runs in CI (keyless verification needs only public Fulcio/Rekor
  roots; no secrets), so it is reproducible and does not weaken the
  no-persistent-secret posture.

## Interim state (today)

ENG-01 has not yet published the contract artifact (MCP Consumer Profile is
"blocked on ENG-01 contract publication"). This ADR specifies the target
verification design so that when ENG-01 delivers, APP-01 adopts
signature+provenance from day one rather than retrofitting hash-only pinning.

## Sources

- Sigstore cosign verifying docs — <https://docs.sigstore.dev/cosign/verifying/verify/> (high)
- Sigstore keyless signing (Fulcio/Rekor/OIDC) — <https://www.systemshardening.com/articles/cicd/sigstore-keyless-signing/> (high)
- Cosign + SLSA + provenance overview — <https://aquilax.ai/blog/supply-chain-artifact-signing-slsa> (medium)
- SLSA framework build levels & provenance — <https://www.decryptiondigest.com/blog/slsa-software-supply-chain-framework-guide> (medium)
- OpenSSF: scaling Sigstore signing — <https://openssf.org/blog/2024/02/16/scaling-up-supply-chain-security-implementing-sigstore-for-seamless-container-image-signing/> (medium)
