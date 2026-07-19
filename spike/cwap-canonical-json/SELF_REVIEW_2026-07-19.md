# Kritischer Self-Review-Pass — CWAP-Integration (2026-07-19)

Adversariale Selbstkritik der ganzen Session (Vero), mit Auflösung je Befund.
Belegregel: jeder „behoben" trägt einen tool-verifizierten Nachweis.

| # | Befund | Schwere | Status | Nachweis / Auflösung |
|---|---|---|---|---|
| F1 | „RFC-8785-kompatibel" überdehnt (CWAP rejectet JCS-gültige Floats → strikte Teilmenge) | P1 | **behoben** | `CONFORMANCE.md` präzises Subset-Framing; README-Claim entschärft; `test_rfc8785_vectors.py` belegt Grenze (float→REJECT) |
| F2 | CI nutzte ambienten Runner-`rustc` (Drift → Determinismus-Beweis auf Sand) | P1 | **behoben** | Workflow pinnt `rustup install 1.97.1 --profile minimal`; zizmor-clean |
| F3 | „spiegelt zizmor-geprüfte Workflows" nie verifiziert | P2 | **behoben** | zizmor v1.27.0 offline **und** online: „No findings" (real gefahren) |
| F4 | Konformität nur gegen eigenen Korpus (kein externes Orakel) | P1 | **behoben** | Offizielle RFC-8785-Vektoren (cyberphone) eingezogen; 3 Impls × 6 Vektoren GRÜN |
| F5 | SHA-Assert nur 3-Wege-Report; keine Provenienz im CI | P3 | **behoben** | Dual-Report-Assert + `sha256sum -c results/sha256.txt` als CI-Step |
| F6 | Same-Family-Selbstzertifizierung der NEUEN Normen (P1–P4, F-04/F-05); „Annehmen" als Default empfohlen | P1 | **teilweise** | Kanonisierungs-Korrektheit durch 2 fremde Orakel abgedeckt (s. F7). **P1–P4/F-04/F-05-Design bleibt offen** — lokaler OpenAI-Cross-Family-Pfad ist quota-blockiert (429); async via 007 (ChatGPT/Gemini) angefragt. Promotion #24 bleibt fail-closed bis Adjudikation. |
| F7 | Scheinbare Unabhängigkeit (Python/Rust/JS alle vom selben Modell) → 3455/3455 = Konsistenz, nicht Korrektheit | P1 | **behoben** | Zwei fremd-autorierte Orakel: cyberphone-JCS-Vektoren (inkl. UTF-16-Supplementary-Sort `weird.json`) + Trail-of-Bits `rfc8785` == CWAP byte-gleich auf 4 Vektoren + 740 Korpus-Accept-Fälle |
| F8 | Spec hand-transkribiert (base64-Korruption) | P2 | **mitigiert** | Provenienz-Notiz in SPEC; normative Autorität = bytegleicher Code + Addendum (Provenienz 12/12 vs sha256.txt) |
| F9 | Fixed-Seed-Fuzz erkundet nur einen Pfad | P3 | **geplant** | `CONFORMANCE.md` dokumentiert cargo-fuzz-nightly + es6testfile100m-Reject-Orakel als nächste Stufe |
| A3 | (aegis) Rust-`HashMap`-Iteration = Scheindeterminismus? | P1 | **widerlegt** | Impl sortiert `Vec<u16>::cmp` (kein HashMap); 5 separate Prozesse → identischer SHA |

## Residual-Risiko (ehrlich)

- **F6 offen:** Die CWAP-spezifische Fehlerpräzedenz P1–P4 und die MUST-Regeln
  F-04/F-05 sind noch nicht cross-family adjudiziert (externe JCS-Orakel decken
  sie nicht ab — sie sind CWAP-Design, kein JCS). Promotion #24 bleibt fail-closed
  bis ChatGPT/Gemini-Votum (007) oder OpenAI-Quota wieder verfügbar.
- Gate ist **advisory**, kein required check → Bypass möglich (bewusst, bis
  Promotion-Reife).
- SHA-Pin ist tamper-**evident**, nicht -**resistant** (aegis): ein kompromittierter
  Upstream einer gepinnten Action bleibt ein Vektor bis zum nächsten Audit.

## Web-Recherche-Grundlage (2026-07-19)

- RFC 8785 offizielle Vektoren: github.com/cyberphone/json-canonicalization/testdata
- Zweites Orakel: Trail of Bits `rfc8785` (trailofbits.github.io/rfc8785.py)
- Subset-Framing: serde-json#1197 + RFC 7493 (I-JSON)
- UTF-16-vs-Codepoint-Sort-Divergenz: RFC 8785 §3.2.3 (direkt)
- GH-Actions-Härtung: zizmor v1.27.0 (docs.zizmor.sh), tj-actions CVE-2025-30066,
  immutable releases GA 2025-10-28, rust-toolchain-Pinning (swatinem.de)
- Fuzzing: Trail of Bits Testing Handbook (cargo-fuzz PR-CI vs nightly)
