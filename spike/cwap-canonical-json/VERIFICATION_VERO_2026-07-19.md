# Unabhängige Verifikation (Vero) — CWAP-Strict-JSON v0.1.2-r1

- Datum: 2026-07-19
- Prüfer: Vero (Claude Opus 4.8), Orchestrator-Kontext, auf User1-Maschine
- Gegenstand: Lieferpaket `cwap-v012-r1-3wege-paket.zip` (Drive/0Browser),
  Autor der Lieferung: Claude (Chat-Instanz), Coworker Research
- Zweck: die behaupteten Zahlen NICHT übernehmen, sondern selbst reproduzieren
  (Regel: equalita-claimed-count-vs-tool + self-verify).

## Umgebung (tool-belegt)

- Python 3.14.4 (`py` launcher)
- Node v24.17.0
- `rustc`: **nicht installiert** in dieser Umgebung → Rust-Leg hier NICHT
  kompilier-/lauffähig.

## Durchgeführte Läufe (real, nicht behauptet)

1. **Referenz-Testsuite** `test_cwap_v012_r1.py` → **31/31 PASS** (echter Lauf).
2. **Eigenes Python-vs-JS-Differential** (`differential_pyjs.py`, von Vero
   geschrieben): reproduziert den Korpus-Generator aus `differential.py`
   (seed 20260719, exakte Reihenfolge: 55 Hand-Fälle + 400 randvalid + 3000
   mutate = 3455) und vergleicht die **Python-Referenz** gegen die
   **JS-Drittimplementation** (`js/batch.mjs`, ein Node-Prozess).

## Ergebnis meines Laufs

    total  3455
    agree  3455        (0 Divergenzen)
    accept 740
    reject 2715
    reject_codes = { INT_OUT_OF_SAFE_RANGE:21, FLOAT_FORBIDDEN:113,
                     NONFINITE_FORBIDDEN:30, DUPLICATE_KEY:2, LONE_SURROGATE:16,
                     INVALID_JSON:1625, INVALID_UTF8:905, DEPTH_EXCEEDED:3 }
    accept_canon_sha256 = 2fa3c49a0de37f64441a9e2a0714404cfdf5096d6c418b4cb9a30c86f044be23
    verdict = GRUEN

Dieser Accept-Kanon-SHA-256 ist **byte-identisch** zum gelieferten
`results/differential-report.json` und zur README-Angabe. Die Reject-Code-
Verteilung stimmt exakt überein.

## Bewertung

- **Bestätigt (stark, tool-belegt):** Python-Referenz und JS-Drittimpl stimmen
  über 3455 Fälle in Entscheid, Kanonbytes (SHA-identisch) und Reject-Code
  überein. 2 von 3 Implementationen unabhängig reproduziert.
- **NICHT hier verifiziert (ehrliche Lücke):** die Rust-Zweitimplementation
  (`rust/cwap_strict_json.rs`) — mangels `rustc` in dieser Umgebung. Der
  gelieferte `results/differential-report.json` (Python vs. Rust) und
  `differential3-report.json` (3-Wege) tragen denselben Kanon-SHA; das ist ein
  konsistenter, aber von mir hier NICHT selbst nachgefahrener Beleg. Zum
  Schliessen: `rustc` installieren, `differential.py` + `differential3.py`
  fahren, Exit 0 erwarten.
- **Property-Fuzz** (`hypothesis_fuzz.py`, P-1/P-2): benötigt ebenfalls die
  Rust-Binary (`differential3.NodeBatch`/`run_rust`) → hier nicht gefahren.
  Hypothesis 6.155.7 ist installiert.

## Reproduktion meines Laufs

    cd spike/cwap-canonical-json
    py test_cwap_v012_r1.py       # 31/31
    py differential_pyjs.py       # Python vs JS, 3455/3455, SHA 2fa3c49a...

Für den vollständigen 3-Wege-Beleg zusätzlich (mit Rust-Toolchain):

    rustc -O --edition 2021 -o rust/cwap_rs rust/cwap_strict_json.rs
    py differential.py            # Python vs Rust
    py differential3.py           # 3-Wege
