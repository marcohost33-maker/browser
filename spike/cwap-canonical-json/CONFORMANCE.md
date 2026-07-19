# CWAP-Strict-JSON — Konformitäts-Aussage & Evidenz

- Datum: 2026-07-19 · gehört zu `SPEC_v0.1.2_DRAFT.md`, ADR-007 Track B, #24.
- Zweck: die Konformitäts-Behauptung PRÄZISE fassen (self-review F1) und mit
  unabhängiger externer Evidenz belegen (F4/F7).

## Präzise Konformitäts-Aussage (verbindlich)

CWAP-Strict-JSON ist **kein vollständiger RFC-8785/JCS-Serialisierer.** Es ist ein
**restringiertes Eingabe-Profil** von JCS:

> Für jede Eingabe, die CWAP **akzeptiert** (Ganzzahlen |n| ≤ 2^53−1, keine
> Floats/NaN/Infinity), ist die Ausgabe **byte-identisch** zu RFC 8785 / JCS.
> CWAP **rejectet** eine Teilmenge sonst-JCS-gültiger Eingaben (jede Zahl mit
> Fraktional- oder Exponentenform) fail-closed. CWAP ist damit „JCS-kompatibel
> auf der akzeptierten Domäne", **nicht** „RFC-8785-konform" im Sinne eines
> Serialisierers, der alle JCS-Eingaben verarbeitet.

Begründung des Float-Bans: RFC 8785 verlangt zwar, NaN/Infinity zu rejecten, aber
ein *konformer* JCS-Serialisierer MUSS Floats akzeptieren und ES6-serialisieren —
genau der fehleranfälligste, sprachabhängigste Teil (IEEE-754/`Number.toString`).
Der Ban eliminiert diese Divergenzklasse *by construction* (vgl. ADR-007-Amendment
§B11/§H). Praxis-Referenz für dieses Framing: serde-json#1197 („serialized integers
are guaranteed to be canonical … don't use floats"). Terminologie: „restricted-domain
/ subset profile"; es existiert keine offizielle IETF-Benennung für ein integer-only
JCS-Profil — CWAP definiert ein proprietäres Profil und deklariert es als solches.

## Externe Orakel (unabhängige Ground-Truth — bricht den common-mode-Blindfleck)

Unsere Python/Rust/JS-Impls sind vom selben Modell geschrieben; ihre 3-Wege-
Einigkeit (3455/3455) misst **Konsistenz, nicht Korrektheit** (N-Version-/common-mode-
Problem, Knight & Leveson). Daher zwei **fremd-autorierte** externe Orakel:

1. **Offizielle RFC-8785-Referenzvektoren** — `github.com/cyberphone/json-canonicalization`
   (vom JCS-Spec-Autor). Eingezogen unter `testdata-rfc8785/` (input/output,
   byte-exakt via GitHub-API). Test: `test_rfc8785_vectors.py` fährt **alle drei**
   Impls gegen diese Vektoren:
   - `arrays/french/unicode/weird` → alle 3 Impls **byte-identisch** zum JCS-Output.
   - `structures` (`56.0`), `values` (Floats) → alle 3 Impls **REJECT FLOAT_FORBIDDEN**.
   - **Diskriminierender Fall `weird.json`:** enthält Supplementary-Plane-Key
     😂 (U+1F602), der per **UTF-16-Code-Unit**-Ordnung VOR dem BMP-Key דּ (U+FB33)
     stehen muss (D83D=55357 < FB33=64307) — Code-Point-Ordnung (128514 > 64307)
     wäre falsch. Alle drei Impls treffen die JCS-Ordnung → der gefährlichste
     common-mode-Bug (Code-Point- statt UTF-16-Sort) ist gegen externes Orakel
     **empirisch widerlegt**. (Die Rust-Impl arbeitet durchgehend in `Vec<u16>`.)

2. **Trail-of-Bits `rfc8785`** (menschlich-autorierte, unabhängige Python-JCS-Impl).
   Test: `test_cross_oracle_tob.py` — auf der **gesamten Accept-Domäne**:
   `CWAP.recanonicalize(raw) == rfc8785.dumps(json.loads(raw))`. Belegt 2026-07-19:
   **4/4 Accept-Vektoren + alle 740 Korpus-Accept-Fälle byte-identisch** zwischen
   CWAP und dem Fremd-Orakel.

3. **JSONTestSuite** („Parsing JSON is a Minefield", nst/Nicolas Seriot) — 318
   fremd-kuratierte Parser-Konformitäts-Fälle (y_/n_/i_), vendored+gepinnt unter
   `testdata-jsontestsuite/` (commit 1ef36fa0). Test: `jts_harness.py` fährt alle
   drei Impls: y_-Dateien akzeptiert oder nur mit CWAP-Semantik-Code rejected,
   n_-Dateien rejected, i_-Dateien konsistent. Belegt 2026-07-19: **318/318 GRÜN**
   (0 Parser-Bugs, 0 Divergenzen). Exponierte die zwei Fixes F-06 (O(n²)-DoS im
   Duplikat-Key-Check → O(n log n), 60k Keys 5.64s→0.093s) und F-07 (Number-Reject
   maximal-munch) sowie Bishop-Fox-Interop-Angriffsvektoren (Key-Kollision via
   lone surrogate → LONE_SURROGATE; Comment-Smuggling-Dup-Key → INVALID_JSON).

Damit ist die Kanonisierung gegen **drei** unabhängige externe Ground-Truths
validiert (JCS-Referenz, ToB, JSONTestSuite), nicht nur selbst-konsistent.

## Determinismus (nicht nur Reject, sondern echte Byte-Stabilität)

- Rust-Impl sortiert Keys explizit über `Vec<u16>::cmp` (UTF-16-Units), **kein**
  `HashMap` → keine per-Prozess-randomisierte Iterationsordnung.
- Empirisch: 5 separate Rust-Prozesse auf `weird.json` → identischer SHA-256.
- `differential.py` startet je Fall einen **eigenen** Rust-Prozess; 3455/3455
  Einigkeit über separate Prozesse widerlegt Prozess-Seed-Abhängigkeit zusätzlich.

## Bewusst abgelehnte Alternative

**dCBOR / deterministisches CBOR** (draft-bormann-cbor-det, Gordian Envelope) hat
Kanonisierung als *primäres* Designziel und wäre für rein maschinelle signierte
Manifeste effizienter/robuster. Bewusst NICHT gewählt, weil der CWAP-Container
**JSON-nativ + menschenlesbar** sein soll. Erwähnt als informierte Option, falls
ein späterer Container binär gehen darf.

## Test-/Fuzzing-Schichtung (Best Practice: deterministisches Gate vs. scheduled)

Deterministisches CI-Gate (jeder PR, exit-code-gated):
- `test_cwap_v012_r1.py` (31 Kernvektoren) · `differential.py`/`differential3.py`
  (3455 Fälle, fixer Seed) · `test_rfc8785_vectors.py` (externe JCS-Vektoren, 3 Impls)
  · `test_cross_oracle_tob.py` (Fremd-Orakel) · `hypothesis_fuzz.py` (fixer Seed).

Geplant / noch offen (scheduled/nightly, nicht blockierend):
- **cargo-fuzz + libFuzzer** mit `Arbitrary`-JSON (structure-aware), Fremd-Orakel
  im Loop — findet, was fixe Tests + selbst-generierter Korpus verfehlen.
- **es6testfile100m** (cyberphone-Release, 100M IEEE-754-Zeilen) als Reject-Pfad-
  Orakel: jede Zeile mit Fraktional-/Exponentenform MUSS → FLOAT_FORBIDDEN; die
  ganzzahlige Teilmenge als Accept-Pfad. (Datei nicht eingecheckt — 100M Zeilen;
  via `numgen` reproduzierbar.)
- OSS-Fuzz-Integration als Zielstufe für eine Signatur-Sicherheitskomponente.
