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
- Rust 1.97.1, Toolchain `stable-x86_64-pc-windows-gnu` (via rustup, 2026-07-19
  während dieser Session installiert; GNU-Host gewählt, weil MSVC-`link.exe`
  fehlt und die GNU-Toolchain selbst-linkt).

## Durchgeführte Läufe (real, nicht behauptet)

1. **Referenz-Testsuite** `test_cwap_v012_r1.py` → **31/31 PASS** (echter Lauf).
2. **Eigenes Python-vs-JS-Differential** (`differential_pyjs.py`, von Vero
   geschrieben): reproduziert den Korpus-Generator aus `differential.py`
   (seed 20260719, exakte Reihenfolge: 55 Hand-Fälle + 400 randvalid + 3000
   mutate = 3455) und vergleicht die **Python-Referenz** gegen die
   **JS-Drittimplementation** (`js/batch.mjs`, ein Node-Prozess).
3. **Voller 2-Wege-Lauf** `differential.py` (Python vs. Rust) — nach lokaler
   Rust-Kompilierung (`rustc -O --edition 2021 -o rust/cwap_rs.exe
   rust/cwap_strict_json.rs`).
4. **Voller 3-Wege-Lauf** `differential3.py` (Python vs. Rust vs. JS).
5. **Property-Fuzz** `hypothesis_fuzz.py` (P-1/P-2, Hypothesis 6.155.7).

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

## Ergebnisse der vollen Läufe (2026-07-19, nach Rust-Install)

    differential.py  (Python vs Rust)        3455/3455 GRUEN, Exit 0
    differential3.py (Python vs Rust vs JS)  3455/3455 GRUEN, Exit 0
    hypothesis_fuzz.py                        P-1 PASS (500) · P-2 PASS (500), Exit 0

Alle Läufe tragen denselben Accept-Kanon-SHA-256 `2fa3c49a…be23`.

## Bewertung

- **Vollständig bestätigt (stark, tool-belegt):** alle **drei** unabhängigen
  Implementationen (Python-Referenz, Rust-Zweitimpl, JS-Drittimpl) stimmen über
  3455 Fälle in Entscheid, Kanonbytes (SHA-identisch), Reject-Code und
  Idempotenz überein — von Vero selbst nachgefahren, nicht nur behauptet. Der
  gelieferte `results/differential-report.json`/`differential3-report.json`
  reproduziert byte-identisch.
- **Keine offene Verifikations-Lücke mehr** auf dieser Seite. Die frühere
  Rust-Lücke (kein `rustc`) ist durch die lokale GNU-Toolchain-Installation +
  Kompilierung geschlossen.
- `rust/cwap_rs.exe` ist ein Build-Artefakt (gitignored), reproduzierbar aus
  `rust/cwap_strict_json.rs`.

## Reproduktion meines Laufs

    cd spike/cwap-canonical-json
    py test_cwap_v012_r1.py       # 31/31
    py differential_pyjs.py       # Python vs JS, 3455/3455, SHA 2fa3c49a...

Für den vollständigen 3-Wege-Beleg zusätzlich (mit Rust-Toolchain):

    rustc -O --edition 2021 -o rust/cwap_rs rust/cwap_strict_json.rs
    py differential.py            # Python vs Rust
    py differential3.py           # 3-Wege
