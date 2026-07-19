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
construction*. Verified across three independent implementations.

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
| `results/` | Delivered reports + `sha256.txt` |
| `README_LIEFERUNG.md` | Original delivery note (Chat-Instanz) |
| `VERIFICATION_VERO_2026-07-19.md` | Vero's independent reproduction + honest Rust gap |

## Evidence status (2026-07-19)

- Corpus: 3455 cases (55 curated + 400 random-valid + 3000 mutation-fuzz).
- Delivered: 3455/3455 Python↔Rust↔JS agreement; canon-SHA
  `2fa3c49a0de37f64441a9e2a0714404cfdf5096d6c418b4cb9a30c86f044be23`.
- **Independently re-verified by Vero (full 3-way):** `differential.py`
  (Py↔Rust) 3455/3455, `differential3.py` (Py↔Rust↔JS) 3455/3455,
  `hypothesis_fuzz.py` P-1/P-2 PASS, 31/31 reference tests — all Exit 0, same
  canon-SHA. Rust built locally (GNU toolchain). See
  `VERIFICATION_VERO_2026-07-19.md`.

## CI-gate wiring — deferred (post owner-decision, post freeze)

Once the Owner accepts D1–D4 + P1–P4, wire a required check that runs
`differential.py` (and `differential3.py`) with a Rust + Node toolchain; a
non-zero exit ⇒ RED. Not added yet, to avoid gating an unaccepted spec and to
respect the active GitHub-budget freeze (no CI-triggering pushes).

## Reproduce

    cd spike/cwap-canonical-json
    py test_cwap_v012_r1.py          # 31/31
    py differential_pyjs.py          # Python vs JS (no Rust), 3455/3455
    # full 3-way (needs rustc + node):
    rustc -O --edition 2021 -o rust/cwap_rs rust/cwap_strict_json.rs
    py differential.py
    py differential3.py
