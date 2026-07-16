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
- Signed HTTP Exchanges (SXG) are a *different* specification from IWA Signed Web
  Bundles (`.swbn`): SXG tooling is not evidence of an `.swbn`/IWA verifier and
  must not be substituted for one (ChatGPT cross-family correction 2026-07-15).
- Track A pins an exact Web Bundle / Integrity Block spec revision and exact
  verifier tool versions (Go/Node/Rust) before any conformance claim; "latest"
  is not a spec.

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

## Primary-source landscape (Quella 2026-07-16)

This ADR stays **PROPOSED**; the review below focuses the two-track spike and decides
nothing. Confidence markers carried over honestly.

- **IWA / `.swbn` is 2026-confirmed Enterprise/ChromeOS-only** — the initial release
  and its high-trust APIs are available only to Chrome-Enterprise-administered ChromeOS
  devices and select development partners; unmanaged cross-platform expansion is
  "in the future" with **no date**. It is **not** a portable cross-platform format in
  2026. The format's building blocks are: Ed25519 or ECDSA P-256 signatures →
  Web-Bundle-ID → app identity; `isolated-app://` origin bound to the signing key
  (not a domain); Integrity Block updated to **v2** (v1 bundles no longer installed
  since ~M129). Architecturally this is the right model; interoperability value today
  is low, reference-architecture value high. `[strong evidence]`
- **Pragmatically best T1 solution today (recommendation, not decision):** an
  **Electron bundle + an own signed Ed25519 / Merkle-SHA256 manifest** (over the root
  hash) **+ OS code-signing** of the bundle, reproducing the IWA *semantics*
  (key-bound app identity, signed offline package) without waiting for IWA's immature
  cross-platform delivery. Ship this as T1; **observe IWA/`.swbn` as the target
  architecture**, do not ship it in 2026. `[building blocks strong; overall
  recommendation plausible]` — this is a recommendation for the spike to test, not an
  accepted decision.
- **Honest gaps to close before STABLE (carried from Quella):** Electron
  `asar integrity` and the Tauri updater signature model were documented from
  secondary snippets, not primary-fetched this session — look them up in the primary
  docs before any STABLE claim. IWA v1-deprecation timing (M129) is plausible but
  should be reconfirmed against the Chromium source before it is load-bearing.

Primary sources (from the Quella 2026-07-16 deliverable):

- IWA / `.swbn`: <https://developer.chrome.com/docs/iwa/introduction> ·
  <https://chromeos.dev/en/tutorials/getting-started-with-isolated-web-apps/2>
- Signing/identity building blocks: IWA Introduction (Ed25519/ECDSA-P256,
  `isolated-app://`, Integrity Block v2), primary-fetched 2026-07-16.

## Deliverables

- [ ] exact parser/verifier dependencies and licenses
- [ ] conformance and fuzz results
- [ ] package identity and publisher trust policy
- [ ] update, rollback, revocation and key-rotation model
- [ ] resource-limit policy
- [ ] independent security review

## Amendments

- 2026-07-16 — [Cross-family verifier hardening requirements](ADR-007-amendment-cross-family-verifier-hardening-2026-07-16.md)
  (Gemini deep review + ChatGPT gates, vetted). Normative REJECT rules for the #24 spike:
  ZIP anti-malleability (comment/ZIP64/encryption/SFX bans, CDH↔LFH consistency, overlap detection),
  RFC 8785 canonicalization (UTF-16 key sort, float ban), Ed25519 strict (SUF-CMA), TOCTOU/atomic-staging/
  path-containment, and the mandatory Python↔Rust differential-test gate.
