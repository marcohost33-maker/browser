# Spike: CWAP-Strict-JSON v0.1.2 (canonical-manifest core)

- Status: **PROMOTED for ADR-007 Track-B manifest representation** on 2026-07-22.
- Parent issue: #24 remains open for container, signature, activation, update,
  publisher, capability and code-safety work.
- Architecture: ADR-007 plus ADR-007a.
- This directory is spike/evidence code, not a package verifier or runtime product.

## Accepted claim

CWAP is a restricted-domain subset profile of JCS. For inputs it accepts, its output
is byte-identical to the pinned canonical behavior. Floats, NaN and Infinity are
rejected; integers are restricted to the accepted safe range. It must not be called
a complete RFC-8785 serializer without the subset qualifier.

## Evidence

- Python, Rust and JavaScript implementations;
- 31-vector reference suite;
- deterministic differential corpora;
- official JCS reference vectors;
- Trail of Bits `rfc8785` foreign oracle on the accepted domain;
- JSONTestSuite parser corpus;
- owner-side re-verification and promotion record.

See `PROMOTION_2026-07-22_browser24.md`, `CONFORMANCE.md` and the result manifests.

## Remaining boundary

This spike does not establish:

- a package container or exact signed-byte region;
- strict package signature verification;
- manifest↔payload bijection in a real package;
- safe extraction, activation or interruption recovery;
- publisher admission or capability approval;
- TUF-style update freshness, revocation or key recovery;
- safe execution of the package.

Those requirements are consolidated in
`docs/adr/ADR-007a-signed-package-verifier-hardening.md` and
`docs/adr/ADR-009-tuf-update-metadata-evaluation.md`.

## Reproduce

```text
cd spike/cwap-canonical-json
py test_cwap_v012_r1.py
py differential_pyjs.py
rustc -O --edition 2021 -o rust/cwap_rs rust/cwap_strict_json.rs
py differential.py
py differential3.py
```
