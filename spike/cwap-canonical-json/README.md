# Spike: CWAP-Strict-JSON v0.1.2-r1 (canonical-JSON manifest core)

- Status: **D1–D4 + P1–P4 owner-ACCEPTED 2026-07-19** (`DECISION_2026-07-19.md`);
  three-way differential fully re-verified by Vero (Py+Rust+JS, see below).
  #24 promotion still fail-closed (CI gate + codebase wire-in open).
  Feeds issue #24 (package/secure-update spike),
  ADR-007 Track B (`docs/adr/ADR-007-signed-package-evaluation.md` +
  `docs/adr/ADR-007-amendment-cross-family-verifier-hardening-2026-07-16.md`).
- This is an **unbuilt-spike artifact**, not runtime product code. Consistent with
  `docs/IMPLEMENTATION_STATUS.md`: no runtime is implemented in this repo.
- **Promotion of #24 remains fail-closed** until the Owner decides D1–D4 + the
  normative error precedence P1–P4 (see `SPEC_v0.1.2_DRAFT.md` and
  `CWAP_v0.1.2-r1_ADDENDUM_FEHLERPRAEZEDENZ.md`).

## What this resolves

The ADR-007 amendment (§B/§H) flagged that RFC-8785/JCS float number-formatting
is implemented correctly by few libraries — a real cross-language divergence risk
for signed-manifest bytes. CWAP-Strict-JSON **bans floats/NaN/Infinity** (D2) and
pins JCS UTF-16 key ordering (D1), which deletes that divergence class *by
construction*.

**Precise conformance claim (do not overstate):** CWAP is a **restricted-domain
subset profile** of JCS — for every input it *accepts* (integers only), its output
is byte-identical to RFC 8785/JCS; it *rejects* JCS-valid float inputs fail-closed.
It is **not** a full JCS serializer and must not be called "RFC-8785-conformant"
without that qualifier. See `CONFORMANCE.md`.

## Layout (flat, so relative cross-references stay runnable)

| Path | Role |
|---|---|
| `SPEC_v0.1.2_DRAFT.md` | Normative canonicalization decisions D1–D4 (owner-gated) |
| `CWAP_v0.1.2-r1_ADDENDUM_FEHLERPRAEZEDENZ.md` | Normative error precedence P1–P4, findings F-01..F-05 |
| `cwap_strict_json.py` | Python reference v0.1.2-r1 (stdlib only) + CLI |
| `test_cwap_v012_r1.py` | Anti-regression suite (22 core + 9 r1 vectors) — 31/31 |
| `rust/cwap_strict_json.rs` | Independent Rust 2nd impl, zero-dependency (no serde) |
| `js/cwap_strict_json.mjs` + `js/batch.mjs` | Independent JS 3rd impl, own tokenizer (BigInt) |
| `differential.py` | Deterministic corpus (seed 20260719) + Python↔Rust runner |
| `differential3.py` | 3-way Python↔Rust↔JS runner |
| `differential_pyjs.py` | Vero's independent Python↔JS runner (no Rust needed) |
| `hypothesis_fuzz.py` | Property-based fuzz P-1/P-2 (needs Rust binary) |
| `testdata-rfc8785/` | **External oracle** — official RFC 8785/JCS reference vectors (cyberphone) |
| `test_rfc8785_vectors.py` | 3 impls × 6 official JCS vectors (accept→byte-match, float→reject) |
| `test_cross_oracle_tob.py` | 2nd **foreign-authored** oracle: CWAP == Trail-of-Bits `rfc8785` on accept domain |
| `jts_harness.py` + `testdata-jsontestsuite/` | 3rd oracle: JSONTestSuite (318 files, vendored+pinned), 3 impls |
| `CONFORMANCE.md` | Precise subset-conformance claim + external-oracle evidence + fuzzing plan |
| `results/` | Delivered reports + `sha256.txt` |
| `README_LIEFERUNG.md` | Original delivery note (Chat-Instanz) |
| `VERIFICATION_VERO_2026-07-19.md` | Vero's independent reproduction |

## Evidence status (2026-07-19)

- Corpus: 3468 cases (r2-expanded: 55+ curated incl. JSONTestSuite-gap +
  Bishop-Fox interop vectors, 400 random-valid, 3000 mutation-fuzz).
- 3468/3468 Python↔Rust↔JS agreement; expanded canon-SHA
  `84aa7110a244344594b0bcb17078439c76b6233f1955c823268857dd26d290f1`
  (original 740-accept subset unchanged → `2fa3c49a…`).
- **Independently re-verified by Vero (full 3-way):** `differential.py`
  (Py↔Rust) 3455/3455, `differential3.py` (Py↔Rust↔JS) 3455/3455,
  `hypothesis_fuzz.py` P-1/P-2 PASS, 31/31 reference tests — all Exit 0, same
  canon-SHA. Rust built locally (GNU toolchain). See
  `VERIFICATION_VERO_2026-07-19.md`.
- **Three external oracles (break the same-author common-mode blind spot):**
  (1) official RFC 8785/JCS reference vectors — all 3 impls match, incl. the
  UTF-16 supplementary-plane sort case `weird.json`; (2) Trail-of-Bits `rfc8785`
  (foreign-authored) == CWAP on all accept vectors + all corpus accepts,
  byte-identical; (3) JSONTestSuite (318 files, vendored+pinned) 318/318.
  See `CONFORMANCE.md`.
- **r2-audit adoption (2026-07-19):** JSONTestSuite exposed two real bugs in the
  earlier r1 impls — F-06 (O(n²) duplicate-key DoS, 60k keys 5.64s→0.093s) and
  F-07 (number-reject classification) — both adopted and cross-checked against
  all three oracles. Expanded corpus fingerprint: `84aa7110…` (the original
  740-accept subset still hashes to `2fa3c49a…`; +4 ToB-verified coverage
  accepts). See `DECISION_2026-07-19.md` §fingerprint-change.

## CI gate — `.github/workflows/cwap-differential.yml` (advisory)

Pins the Rust toolchain (exact patch, replaces ambient runner rustc — reproducible
byte-determinism), then runs: delivered-source provenance (`sha256sum -c`), the
31-vector reference suite, the 2-way + 3-way differential, the external RFC 8785
oracle vectors across all three impls, and a dual accept-canon-SHA assert against
the owner-accepted fingerprint (fail-closed). zizmor-clean (offline + online, v1.27.0).
**Advisory + path-filtered** (not a required check) while #24 is an unbuilt spike —
promote to required post-promotion. Not pushed yet (GitHub-budget freeze).

The `hypothesis_fuzz.py` property fuzz and `test_cross_oracle_tob.py` (needs the
`rfc8785` pip package) are kept out of the dependency-free CI gate and run locally;
a coverage-guided `cargo-fuzz` nightly is the planned next fuzzing layer
(`CONFORMANCE.md`).

## Reproduce

    cd spike/cwap-canonical-json
    py test_cwap_v012_r1.py          # 31/31
    py differential_pyjs.py          # Python vs JS (no Rust), 3455/3455
    # full 3-way (needs rustc + node):
    rustc -O --edition 2021 -o rust/cwap_rs rust/cwap_strict_json.rs
    py differential.py
    py differential3.py
