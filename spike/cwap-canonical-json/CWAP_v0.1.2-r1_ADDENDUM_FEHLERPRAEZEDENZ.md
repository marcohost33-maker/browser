# CWAP-Strict-JSON v0.1.2-r1 — Addendum: Normative Fehlerpraezedenz + Haertungen

Status: DRAFT-Ergaenzung zu CWAP_CANONICAL_JSON_v0.1.2_DRAFT.md (Owner-Entscheid
D1-D4 weiterhin offen; dieses Addendum aendert D1-D4 NICHT, es schliesst drei
im Differentiallauf 2026-07-19 nachgewiesene Luecken).
Kontext: browser-Repo (APP-01), ADR-007 Track B, Issue #24.
Attribution: Coworker Research / Coworkerz | 2026-07-19

## Befunde (Fuzzing + Differentiallauf, Evidenzklasse E2: Code-Execution)

**F-01 — Lone Surrogates verletzten den Fail-Closed-Vertragstyp.**
Eingaben wie `"\udc00"` (Escape im JSON-Text) passierten CPythons Parser und
fuehrten in der v0.1.2-Referenz zu `UnicodeEncodeError` statt `CanonReject`
(beim UTF-8-Encode des Outputs bzw. beim UTF-16-Sort-Key). Effektiv fail-closed,
aber der falsche Fehlertyp bricht den Verifier-Vertrag (Aufrufer fangen
CanonReject). Fix r1: expliziter Reject-Code `LONE_SURROGATE` in Escape-Pfad
und Sort-Key-Pfad; gepaarte Surrogate (`"\ud83d\ude42"`) bleiben gueltig und
werden zum Codepoint kombiniert.

**F-02 — Tiefen-Limit hing bei Extremtiefe am RecursionError.**
`parse_strict` verliess sich fuer Verschachtelung > ~1000 auf CPythons
RecursionError (-> INVALID_JSON), waehrend 65..~1000 erst post-parse
DEPTH_EXCEEDED ergab — nicht deterministisch ueber Implementationen und ein
Stack-Exhaustion-Vektor. Fix r1: strukturelles Depth-Gate (String-Literal-
bewusster Scanner) VOR json.loads; Tiefe > 64 rejected immer und ueberall als
`DEPTH_EXCEEDED`.

**F-03 — Fehlerpraezedenz war unspezifiziert.**
Der erste Differentiallauf (3455 Faelle) zeigte 0 Entscheid- und 0 Byte-
Divergenzen, aber 26 Reject-CODE-Divergenzen bei Mehrfach-Fehler-Eingaben
(z.B. Out-of-Range-Int + spaeterer Syntaxfehler). Ohne normative Praezedenz
sind Reject-Codes zwischen Implementationen nicht vergleichbar — fuer
Verifier-Interop und Testbarkeit inakzeptabel. Fix: Praezedenz unten ist
normativ; die Rust-Zweitimplementation wurde exakt darauf gebaut, danach
3455/3455 GRUEN inkl. Codes.

## Normative Fehlerpraezedenz (P1-P4)

Bei Eingaben mit mehreren Verletzungen bestimmt die frueheste Stufe, dann die
frueheste Position den Reject-Code:

P1  INVALID_UTF8 — ganzheitliche UTF-8-Dekodierung des Eingabepuffers.
P2  DEPTH_EXCEEDED — strukturelles Pre-Gate: Zaehlung von `[`/`{`-Nesting
    ausserhalb von String-Literalen (Escape-bewusst); > 64 rejected, bevor
    geparst wird.
P3  Scan-Ordnung (links nach rechts, ein Durchlauf):
    - FLOAT_FORBIDDEN an der Position eines syntaktisch gueltigen
      Float-Tokens (`.`/`e`/`E`); syntaktisch kaputte Zahl -> INVALID_JSON.
    - NONFINITE_FORBIDDEN an der Position von `NaN`/`Infinity`/`-Infinity`.
    - DUPLICATE_KEY beim SCHLIESSENDEN `}` des betroffenen Objekts (nicht
      beim zweiten Auftreten des Keys) — ein Syntaxfehler vor diesem `}`
      gewinnt als INVALID_JSON.
    - Jede sonstige Grammatikverletzung (auch Trailing-Data, fuehrende
      Nullen, rohe Controls in Strings) -> INVALID_JSON an ihrer Position.
P4  Post-Parse in Kanon-Traversierungsordnung (Objekte: erst Surrogat-
    Pruefung ALLER Keys in Einfuege-Ordnung, dann Emission in sortierter
    Key-Ordnung; Arrays links nach rechts):
    - LONE_SURROGATE (ungepaarte UTF-16-Units aus `\uXXXX`-Escapes).
    - INT_OUT_OF_SAFE_RANGE (|n| > 2^53-1; Betrag beliebig gross).

Begruendung der Stufung: P1/P2 sind billige, DoS-hartende Ganzpuffer-Gates;
P3 entspricht dem natuerlichen Ein-Pass-Scanner (und exakt CPythons
Hook-Semantik, d.h. die Referenz definiert die Praezedenz, nicht umgekehrt);
P4 sind Werte-Semantik-Checks, die einen vollstaendig geparsten Baum
voraussetzen. Nur der ACCEPT/REJECT-Entscheid und die Kanonbytes sind
sicherheitskritisch; die Code-Praezedenz ist Interop-/Diagnose-Vertrag.

## Differential-Korpus (D4) — Stand 2026-07-19

- Generator deterministisch (seed 20260719, PYTHONHASHSEED-unabhaengig nach
  Fix der set-Iterationsordnung): 55 kuratierte Faelle, 400 zufallsgueltige
  loose-serialisierte Dokumente, 3000 Mutations-Fuzz-Iterationen = 3455.
- Ergebnis: 3455/3455 Uebereinstimmung Python-Referenz vs. Rust-Zweitimpl.
  (Entscheid, Kanonbytes, Reject-Code, beidseitige Idempotenz).
  Accept 740 / Reject 2715; Korpus-Kanon-SHA-256 (konkatenierte
  Accept-Bytes): 2fa3c49a0de37f64441a9e2a0714404cfdf5096d6c418b4cb9a30c86f044be23
- Reproduzierbarkeit: zwei unabhaengige Laeufe byte-identisch (Report inkl.
  aller Zaehler und SHA identisch).
- Unabhaengigkeit: Rust-Implementation ist zero-dependency (kein serde),
  eigener Parser — bewusst, da publizierte JCS-Crates teils vom RFC abweichen
  bzw. verwaist sind; geteilte Bibliotheken wuerden geteilte Fehler bedeuten.

## Offen (unveraendert + neu)

1. Owner-Entscheid Marco/Vero ueber D1-D4 UND dieses Addendum (P1-P4).
2. Einbau r1-Referenz + Rust-Impl ins browser-Repo via Vero (Draft-PR),
   Differential-Korpus als CI-Gate (`differential.py`, Exit != 0 = ROT).
3. Coverage-Fuzzing (cargo-fuzz/libFuzzer bzw. Atheris) als Ausbaustufe des
   Mutations-Fuzzers — im Container nicht verfuegbar, auf Vero-Seite moeglich.
4. Promotion browser#24 bleibt fail-closed bis 1.-2. erledigt.

## Nachtrag 2026-07-19 (2. Session-Haelfte): JS-Drittimplementation

**F-04 — Host-Parser-Verbot (normativ, MUST).**
Ein konformer Verifier DARF den Host-JSON-Parser (JSON.parse, serde_json::
from_str mit f64, Go encoding/json auf interface{}) NICHT fuer den
Accept-Pfad verwenden. Beweisfall JS: JSON.parse("9007199254740993") liefert
still 9007199254740992 (INT_OUT_OF_SAFE_RANGE unerkennbar), und 1.0 ist nach
dem Parsen von 1 ununterscheidbar (FLOAT_FORBIDDEN unpruefbar). Konforme
Implementationen tokenisieren selbst; Integer-Tokens verlustfrei (BigInt/
i128/int) mit Range-Check erst auf Stufe P4.

**F-05 — Host-Decoder-BOM-Falle (normativ, MUST).**
Der 3-Wege-Differentiallauf fand exakt 1 Divergenz: die JS-Implementation
akzeptierte "\ufeff{}" als "{}", weil TextDecoder die BOM per Default
strippt (ignoreBOM=false). Python/Rust rejecten korrekt (INVALID_JSON).
Normativ: eine fuehrende U+FEFF ist Teil des Eingabetexts und macht das
Dokument ungueltig; Dekodierer MUESSEN BOM-Stripping deaktivieren
(TextDecoder: {fatal:true, ignoreBOM:true}).

**3-Wege-Differential (Python vs. Rust vs. JS), Stand nach F-05-Fix:**
3455/3455 GRUEN (Entscheid, Kanonbytes, Reject-Codes, 3-seitige Idempotenz).
Korpus-Kanon-SHA-256 identisch zum 2-Wege-Lauf:
2fa3c49a0de37f64441a9e2a0714404cfdf5096d6c418b4cb9a30c86f044be23
— die Kanonbytes sind damit dreifach unabhaengig bestaetigt.

**Property-Based-Fuzzing (Hypothesis 6.156, derandomisiert):**
P-1 (500 Bsp.): jeder gueltige Wert, loose serialisiert -> 3-Wege-Accept,
byte-identisch, idempotent. P-2 (500 Bsp.): beliebige Byte-Kompositionen
(BOM/Surrogate/Grenzzahlen/Fragmente) -> 3-Wege-identisches Resultat, nie
unkontrollierter Crash. Beide PASS.
