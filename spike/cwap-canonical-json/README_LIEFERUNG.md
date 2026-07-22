# CWAP v0.1.2-r1 — Rust- + JS-Implementation, 3-Wege-Differential (D4), Property-Fuzzing

Lieferung 2026-07-19 · Claude (Chat-Instanz) · Coworker Research / Coworkerz
Ziel: browser-Repo (APP-01), ADR-007 Track B, Issue #24 — Roadmap-Schritte
"Rust-Zweitimplementation gegen den Korpus" + "Fuzzing der parse_strict-Grenzen".
KEIN Repo-Push aus dieser Session (Repo-Zugriff liegt bei Vero); Integration
als Draft-PR-Vorschlag.

## Inhalt

| Datei | Zweck | Evidenz |
|---|---|---|
| cwap_strict_json.py | Python-Referenz v0.1.2-r1 (gehaertet: F-01 LONE_SURROGATE, F-02 Depth-Gate) + CLI stdin->stdout | 31/31 Tests |
| rust/cwap_strict_json.rs | Unabhaengige Rust-Zweitimplementation, zero-dependency (kein serde), praezedenz-konform | Differential GRUEN |
| test_cwap_v012_r1.py | Anti-Regression (22 Kernvektoren v0.1.2) + 9 r1-Vektoren | 31/31 PASS |
| differential.py | Korpus-Generator (seed 20260719, deterministisch) + Runner + Mutations-Fuzzer | 3455/3455 GRUEN, 2 Laeufe byte-identisch |
| results/differential-report.json | Maschinenlesbarer Report (Zaehler, Codes, Korpus-SHA) | — |
| CWAP_v0.1.2-r1_ADDENDUM_FEHLERPRAEZEDENZ.md | Normative Fehlerpraezedenz P1-P4 + Befunde F-01..F-05 | — |
| js/cwap_strict_json.mjs | JS-Drittimplementation, eigener Tokenizer (BigInt), zero-dependency; F-04/F-05-konform | 3-Wege GRUEN |
| js/batch.mjs | Batch-Harness (1 Node-Prozess fuer ganzen Korpus) | — |
| differential3.py | 3-Wege-Differential Python/Rust/JS, gleicher Korpus | 3455/3455 GRUEN |
| results/differential3-report.json | 3-Wege-Report | — |
| hypothesis_fuzz.py | Property-Based-Fuzzing P-1/P-2 (Hypothesis, derandomisiert) | 2/2 PASS |

## Reproduktion

    rustc -O --edition 2021 -o rust/cwap_rs rust/cwap_strict_json.rs
    python3 test_cwap_v012_r1.py          # 31/31, Exit 0
    python3 differential.py               # 2-Wege, 3455 Faelle, Exit 0 = GRUEN
    python3 differential3.py              # 3-Wege (+ node v22), Exit 0 = GRUEN
    pip install hypothesis && python3 hypothesis_fuzz.py   # P-1/P-2

## Kernergebnis

3455/3455 Uebereinstimmung Python vs. Rust vs. JS in Entscheid, Kanonbytes,
Reject-Code und 3-seitiger Idempotenz; + 1000 Hypothesis-Beispiele PASS.
Der 3-Wege-Lauf fand vor dem Fix genau 1 echte Divergenz (F-05 BOM) —
der Nachweis, dass die Methode traegt. Korpus-Kanon-SHA-256:
2fa3c49a0de37f64441a9e2a0714404cfdf5096d6c418b4cb9a30c86f044be23

## Entscheide angefragt (Owner Marco/Vero)

1. D1-D4 (unveraendert offen) + Addendum P1-P4 annehmen/ablehnen.
2. r1-Haertungen in die Referenz uebernehmen (F-01/F-02 sind Bugfixes,
   keine Kanon-Aenderung: Accept-Menge und Kanonbytes unveraendert).
3. differential.py als CI-Gate im browser-Repo (Rust-Toolchain in CI noetig).
