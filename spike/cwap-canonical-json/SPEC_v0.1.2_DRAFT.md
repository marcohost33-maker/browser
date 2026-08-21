# CWAP-Strict-JSON v0.1.2 — Normativer Kanonisierungs-Standard (ACCEPTED)

Status: **ACCEPTED / PROMOTED 2026-07-22.** D1–D4 vom Owner ANGENOMMEN 2026-07-19
(`DECISION_2026-07-19.md`); P1–P4-Fehlerpräzedenz + 5 F6-Präzisierungssätze owner-seitig
ADJUDIZIERT 2026-07-22 (`ADJUDICATION_F6_2026-07-22.md`), branch nach main gelandet
(`PROMOTION_2026-07-22_browser24.md`). Dies promotet die **kanonische Manifest-
Repräsentation von ADR-007 Track B** — NICHT das gesamte Issue #24 (Track A `.swbn`/IWA,
Track C TUF-Secure-Update, Publisher-Admission, Capability-Approval, Code-Safety bleiben OFFEN).
Kontext: browser-Repo (APP-01), ADR-007 Track B. Löst den im Cross-Family-Review
2026-07-17 (ChatGPT) benannten Blocker auf: v0.1.1-Custom-Canonical-JSON vs.
Issue-#24-Kanon (JCS / Safe-Integer / Extensions / NAR) war nicht normativ
aufgelöst.

> Provenienz: Diese Datei ist eine verbatim-treue Übertragung des Drive-Originals
> `CWAP_CANONICAL_JSON_v0.1.2_DRAFT.md` (0Browser, 2026-07-18). Die normative
> Autorität liegt in der Referenzimplementierung `cwap_strict_json.py` und dem
> `CWAP_v0.1.2-r1_ADDENDUM_FEHLERPRAEZEDENZ.md`, die byte-identisch aus dem
> Lieferpaket übernommen sind.

## Entscheidungen

D1 — Serialisierung: RFC-8785-(JCS)-kompatibel. Schlüsselsortierung erfolgt
über UTF-16-Code-Units (nicht Codepoints), String-Escaping ES-konform
(Kurz-Escapes \b \t \n \f \r \" \\, übrige Controls als \u00xx lowercase),
keine Whitespaces, UTF-8-Ausgabe.

D2 — Zahlenraum: Ganzzahlen mit |n| ≤ 2^53−1. Floats, NaN und Infinity werden
REJECTED (fail-closed), sowohl im Objektmodell als auch als Token im
Eingabetext. Begründung: Die einzige sprachabhängige Mehrdeutigkeit von JCS
ist die ES-Number-Formatierung von Gleitkommazahlen; CWAP-Manifeste benötigen
keine Floats (Grössen, Zähler, Zeitstempel als Ganzzahlen). Der Ausschluss
macht Python-, Rust- und JS-Implementationen ohne Sonderfälle bytegleich und
eliminiert eine ganze Differentialtest-Klasse.

D3 — Extensions: Unbekannte Felder ausserhalb eines optionalen "ext"-Objekts
rejected der Verifier auf Manifest-Ebene. "ext" wird mitkanonisiert und
mitgehasht, darf die Verifikationssemantik aber nicht beeinflussen.

D4 — NAR: Kein NAR-Vergleich als Normativquelle. Äquivalenzfragen laufen über
einen separaten Differential-Korpus (Python-Referenz vs. Rust-Zweitimplementation).

Weitere fail-closed-Regeln der Referenz: Duplikat-Keys REJECT (auch im
Eingabetext via strengem Parser), Nicht-String-Keys REJECT, Verschachtelungs-
tiefe > 64 REJECT, ungültiges UTF-8 REJECT.

## Migration v0.1.1 → v0.1.2

Das Custom-Canonical-JSON aus v0.1.1 wird ersetzt. Bestehende Signaturen über
v0.1.1-Kanonbytes bleiben nur gegen v0.1.1-Verifier gültig; v0.1.2-Verifier
MÜSSEN die Kanonbytes neu berechnen und dürfen keine v0.1.1-Bytes akzeptieren
(Versionsfeld im Manifest entscheidet, Mischbetrieb REJECT).

## Referenzimplementation und Evidenz

`cwap_strict_json.py` (nur Standardbibliothek): `canonicalize`, `parse_strict`,
`recanonicalize`. Testsuite `test_cwap_strict_json.py`: 22/22 PASS in dieser
Session (Python 3, Sandbox), inkl. UTF-16-Sortiervektor (U+10000 vor U+FF01 —
der Fall, in dem Codepoint-Sortierung falsch wäre), Escaping-Vektoren,
Safe-Integer-Grenzen ±(2^53−1), Reject-Pfade (Float/1.0/1e2/NaN/Infinity/
Duplikat-Key/Tiefe/UTF-8) sowie 200-Fälle-Differential (Idempotenz,
Formatierungs-Invarianz).

> r1-Nachtrag (2026-07-19): Die gehärtete Referenz `cwap_strict_json.py` in
> diesem Verzeichnis trägt zusätzlich die Fixes F-01 (LONE_SURROGATE) und F-02
> (strukturelles Depth-Gate) und fährt 31/31 (`test_cwap_v012_r1.py`). Accept-
> Menge und Kanonbytes sind gegenüber v0.1.2 unverändert (F-01/F-02 sind
> Bugfixes, keine Kanon-Änderung). Details: `CWAP_v0.1.2-r1_ADDENDUM_FEHLERPRAEZEDENZ.md`.

## F6-Präzisierungen (2026-07-22): implementierungs-autarke Normsätze

Zweck: die im Normtext bisher nur RFC-8785-implizit vorhandenen Kanten explizit
machen, damit eine unabhängige N-te Implementation ALLEIN aus diesem Text baubar
ist (die Viert-Impl C musste 3 Stellen aus RFC-8785-Allgemeinwissen ableiten).
Diese Sätze ändern das Verhalten des v0.1.2-Engine NICHT (3 unabhängige Legs
divergenzfrei: Python + JS + Fremd-Oracle Trail-of-Bits-rfc8785; siehe
`ADJUDICATION_F6_2026-07-22.md`). Sie präzisieren D1/D2; sie ersetzen nichts.

- **(a) ES/JCS-String-Escaping, vollständig.** Präzisiert D1. Der Kanonisierer
  verwendet die Zwei-Zeichen-Escapes `\b \t \n \f \r \" \\`; jedes weitere
  C0-Steuerzeichen (U+0000–U+001F) als `\u00xx` mit KLEINEN Hexziffern; `/`
  (U+002F) wird NICHT escaped; jedes andere Zeichen wird als literale UTF-8-Bytes
  emittiert (KEIN `\uXXXX`-Escaping von Nicht-ASCII). Beleg: RFC-8785-Referenz-
  vektor (ð U+1F602) byte-gleich, Fremd-Oracle-Übereinstimmung.
- **(b) `-0` → `0`.** Präzisiert D2. Das Zahl-Token `-0` MUSS zum kanonischen
  Byte `0` normalisiert werden; die Kanonbytes tragen kein Vorzeichen für Null.
  Beleg: `edge_minus_zero_canon → ACCEPT:0`.
- **(c) Top-Level-Skalare zulässig (RFC-8259).** Engine-/Grammatik-Schicht. Ein
  einzelnes Top-Level-Skalar (String, nichtnegative-Integer-Zahl, `true`,
  `false`, `null`) ist ein gültiges Dokument und wird kanonisiert. Die
  Beschränkung „Wurzel MUSS Objekt sein" gilt AUSSCHLIESSLICH für die
  Manifest-Schicht (Manifest-Constraint, nicht Engine-Constraint). Beleg:
  `edge_max_safe_accept → ACCEPT:9007199254740991`.
- **(e) Key-Vergleich = UTF-16-Code-Unit-Folge, KEINE Unicode-Normalisierung.**
  Präzisiert D1 (Sortierung) und die Duplikaterkennung. Object Keys werden nach
  Escape-Dekodierung (inkl. Zusammensetzung gepaarter Surrogate) als Folgen von
  UTF-16-Code-Units binär verglichen und sortiert; es findet KEINE Normalisierung
  (NFC/NFD/NFKC/NFKD) statt — weder für Duplikaterkennung noch für Sortierung.
  Schließt die NFC/NFKC-Key-Smuggling-Klasse konstruktiv. Beleg: NFC-vs-NFD-Key →
  kein Duplikat; escaped-vs-literal-Emoji → DUPLICATE_KEY.

(Der fünfte Satz (d) — EOF-Fall ohne schließendes `}` → INVALID_JSON — gehört zur
Präzedenz-Schicht und steht im Addendum, P3-DUPLICATE_KEY-Bullet.)

## E5/E6/E7 — Ressourcen- und Zeichen-Grenzen (Ist-Zustand, 2026-08-21)

> **Provenienz-Abgrenzung:** Dieser Abschnitt ist NICHT Teil des Drive-Originals
> `CWAP_CANONICAL_JSON_v0.1.2_DRAFT.md` (2026-07-18). Er wurde am 2026-08-21
> ergänzt, um den GEMESSENEN Ist-Zustand dreier Punkte festzuschreiben, die der
> 007-Antwortbrief vom 2026-07-19 („ANTWORT R4 BROWSER CWAP 3WEGE KONFORMITAET",
> Owner-Entscheide E1–E8) zur Entscheidung vorgelegt hat und die — anders als
> E1–E4 — nie entschieden wurden, während die Implementation sie faktisch schon
> fährt. Jeder Wert unten stammt aus dem Code (Datei:Zeile) oder aus einem
> Messlauf; nichts ist gesetzt, was nicht gemessen wurde.

### E5 — Rechenaufwand der Duplikat-Prüfung: gemessen, normative Form OFFEN

**Ist-Zustand (Code).** Alle drei Implementationen prüfen Duplikat-Keys in
O(n log n) oder besser:

- Python `cwap_strict_json.py:146-152` (`_pairs_hook`): Dict-Mitgliedschaft
  `if k in d` — erwartet O(1) je Key, O(n) je Objekt.
- Python `cwap_strict_json.py:94-100` (`_canon`): zusätzlicher `set`-Check über
  die Keys — O(n).
- Rust `rust/cwap_strict_json.rs:130-139`: `refs.sort_unstable()` plus
  `windows(2)`-Nachbarvergleich — O(n log n). Der Kommentar in `:127-129` hält
  den Fix F-06 fest (vorher O(n²), 60k Keys = 5.3 s).
- JS `js/cwap_strict_json.mjs:106-111`: `new Set()` je Objekt-Ende — erwartet O(n).

**Ist-Zustand (Messung 2026-08-21).** Wanduhr des vollständigen CLI-Pfads
(Prozessstart + Parsen + Kanonisieren + Ausgabe schreiben), also eine Obergrenze
für den Anteil der Duplikat-Prüfung; Objekt mit ausschliesslich eindeutigen Keys
(Worst Case für den Check):

| Keys | Python | Rust | JS |
|---|---|---|---|
| 1 000 | 0.06 s | 0.01 s | 0.07 s |
| 10 000 | 0.09 s | 0.02 s | 0.09 s |
| 60 000 | 0.24 s | 0.07 s | 0.19 s |
| 200 000 | 0.74 s | 0.17 s | 0.45 s |

Umgebung: Windows 11 (MINGW64_NT-10.0-26200), Python 3.14.4, Node v24.17.0,
Rust-Binary `rust/cwap_rs.exe` aus dem Lieferpaket. Das im Brief vorgeschlagene
Zeitbudget „200k Keys < 2 s" wird von allen drei Implementationen mit Abstand
eingehalten.

**Was der Ist-Zustand NICHT entscheidet.** E5 fragte nach der *normativen Form*:
Komplexitäts-MUST für jede konforme Implementation gegenüber blosser
CI-Empfehlung mit Zeitbudget. Das ist eine Owner-Entscheidung, keine Eigenschaft
des Codes — der gemessene Ist-Zustand kann sie nicht ersetzen. **E5 bleibt
insoweit OFFEN.** Festgeschrieben ist nur, dass die drei vorliegenden
Implementationen die Schranke heute einhalten; wer eine vierte Implementation
baut, hat damit einen belegten Referenzwert, aber keine Pflicht.

**Testabdeckung.** Getestet ist die *Korrektheit* bei grossem n, nicht die Zeit:
`test_ist_zustand_e5_e7.py::test_e5_duplikat_wird_auch_bei_60k_keys_gefunden`
(plus Accept-Gegenstück). Ein Zeitbudget-Assert ist bewusst NICHT gesetzt:
Wanduhr-Zeiten sind maschinen- und lastabhängig, ein solcher Assert wäre im CI
ein Flake-Generator und würde eine Sicherheitsaussage vortäuschen, die er nicht
trägt.

### E6 — Maximale Eingabegrösse: KEIN Ist-Zustand, bleibt OFFEN

**Ist-Zustand: es gibt keine Grössengrenze.** Keine der drei Implementationen
kennt einen Deckel für die Eingabegrösse. Die einzigen Ressourcen-Grenzen im
Code sind die Verschachtelungstiefe `MAX_DEPTH = 64`
(`cwap_strict_json.py:28`, `rust/cwap_strict_json.rs:30`,
`js/cwap_strict_json.mjs:29`) und der Zahlenraum `MAX_SAFE_INT`
(`cwap_strict_json.py:27`).

**Messung 2026-08-21.** Ein gültiges Dokument von 8 MiB wird akzeptiert:
Python ACCEPT (1.52 s), Rust ACCEPT (0.48 s). Ebenso 1 MiB, 4 MiB und 5 MiB.

**Ausdrückliche Abweichung von der Umlauf-Annahme.** Die Lesart „4 MiB, alles
Grössere wird abgelehnt" trifft den Ist-Zustand NICHT. Die 4 MiB sind der
*Vorschlag* aus dem Brief (E6: „Maximal-Eingabegroesse fuer Verifier (Vorschlag
4 MiB, fail-closed)") und wurden nie implementiert. Es gibt dazu weder Code noch
Test.

**Warum hier nichts festgeschrieben wird.** Eine Zahl in diesen Text zu
schreiben, die im Code nicht existiert, wäre eine erfundene Norm — und
gefährlicher als die benannte Lücke, weil sie den Verifier als gehärtet
erscheinen liesse, ohne dass ein Byte davon durchgesetzt wird. **E6 bleibt
OFFEN.** Die Entscheidung gehört sachlich zu ADR-007a §1 („Input and resource
envelope"), das „manifest bytes before parsing" als zu pinnende und zu testende
Grenze verlangt — diese Anforderung ist heute unerfüllt.

### E7 — Unicode-Nichtzeichen: FESTGESCHRIEBEN als Durchreichen

**Ist-Zustand: Nichtzeichen werden akzeptiert und unverändert durchgereicht.**
`_escape_string` (`cwap_strict_json.py:47-61`) rejectet ausschliesslich Surrogate
`U+D800`–`U+DFFF` (`:51-52`); C0-Steuerzeichen werden escaped (`:56-57`); jedes
andere Zeichen wird literal als UTF-8 emittiert (`:58-59`). Nichtzeichen — die 66
Codepunkte `U+FDD0`–`U+FDEF` sowie `U+xFFFE`/`U+xFFFF` jeder Ebene — fallen in
den letzten Zweig. Es gibt keine Nichtzeichen-Prüfung.

**Messung 2026-08-21, drei Implementationen (Python/Rust/JS), byte-identisch:**

| Fall | Ergebnis |
|---|---|
| `U+FFFE`, `U+FFFF`, `U+FDD0` literal im Wert | ACCEPT, literale UTF-8-Bytes |
| `U+FFFE` als `u`-Escape geschrieben | ACCEPT, kanonisiert zu literalen Bytes |
| `U+FFFE` literal im KEY | ACCEPT, Key wird normal sortiert |
| `U+1FFFE` (supplementäres Nichtzeichen) | ACCEPT, literale UTF-8-Bytes |
| Positiv-Kontrolle: Lone Surrogate `udc00` | REJECT `LONE_SURROGATE` |

Die Positiv-Kontrolle belegt, dass der Reject-Pfad derselben Funktion scharf ist
— die ACCEPT-Zeilen darüber sind damit ein Befund, kein toter Prüfpfad.

**Normativ (festgeschrieben).** Ein konformer CWAP-Verifier DARF Unicode-
Nichtzeichen NICHT wegen ihrer Nichtzeichen-Eigenschaft ablehnen. Sie sind
gültiges Unicode und gültiges UTF-8; sie werden wie jedes andere Zeichen literal
emittiert und nehmen an Sortierung und Duplikaterkennung teil
(UTF-16-Code-Unit-Vergleich, siehe F6-Satz (e)). Der in E7 genannte Alternativweg
„strikt-I-JSON-Reject" (RFC 7493 rät von Nichtzeichen ab) ist damit ABGELEHNT —
Begründung: Durchreichen ist interop-sicher, dreifach divergenzfrei belegt, und
ein Reject würde eine zusätzliche, im Kanon nicht belegte Ablehnungsklasse
einführen.

**Testabdeckung.** Bereits vorher vorhanden: `differential.py:107`
(`noncharacter_passthrough`, `U+FFFF`) — Teil des 3-Wege-Korpus, dessen
Accept-Fingerprint `84aa7110…` das CI-Gate fail-closed prüft. Neu ergänzt:
`test_ist_zustand_e5_e7.py` deckt zusätzlich `U+FFFE`, `U+FDD0`, `U+FDEF`,
`U+10FFFF`, das supplementäre `U+1FFFE`, die Escape-Form und die Key-Position ab,
plus die Lone-Surrogate-Positiv-Kontrolle (13 Fälle).

**Rücknahmeprobe (2026-08-21).** Die neuen Tests wurden mit
`Tools/diskriminierung.py` gegen fünf Mutationen des Produktivcodes geprüft:
5/5 DISKRIMINIERT, Exit 0. Ein erster Lauf lieferte für zwei Fälle „ROT,
ART-UNBESTIMMT" — die Mutation hatte einen `SyntaxError` erzeugt, der Test starb
also am Absturz statt am Urteil; nach Korrektur der Mutation starben alle Fälle
an der Zusicherung. Das Werkzeug unterscheidet beides, und nur der zweite Lauf
ist ein Beleg.

## Offen (Owner/Cross-Family)

- Owner-Entscheid über D1–D4: **ANGENOMMEN 2026-07-19** (`DECISION_2026-07-19.md`).
- P1–P4-Fehlerpräzedenz + F6-Präzisierungen (a)–(e): **ADJUDIZIERT 2026-07-22**
  (Vero owner-seitig, Marco-angewiesen; Fremd-Oracle + ChatGPT-Votum als
  Unabhängigkeits-Anker) — `ADJUDICATION_F6_2026-07-22.md`. Der frühere „warte auf
  ChatGPT UND Gemini"-Hold ist damit AUFGEHOBEN: die Präzedenz ist laut Addendum
  ausdrücklich **Interop-/Diagnose-Vertrag, nicht sicherheitskritisch** (nur
  ACCEPT/REJECT + Kanonbytes sind sicherheitskritisch, und die sind durch das
  Fremd-Oracle unabhängig bestätigt).
- **E5/E6/E7 (Brief 2026-07-19), Stand 2026-08-21** — siehe Abschnitt
  „E5/E6/E7 — Ressourcen- und Zeichen-Grenzen" oben:
  - **E5** Ist-Zustand gemessen und dokumentiert (alle drei Impls O(n log n) oder
    besser, 200k Keys ≤ 0.74 s). Die *normative Form* (MUST gegenüber
    CI-Empfehlung) ist eine Owner-Entscheidung und bleibt **OFFEN**.
  - **E6** **OFFEN, mangels Ist-Zustand**: es existiert keine Eingabegrössen-
    Grenze; die kursierenden 4 MiB sind ein nie implementierter Vorschlag.
    Gehört zu ADR-007a §1.
  - **E7** **ENTSCHIEDEN/festgeschrieben**: Nichtzeichen werden durchgereicht,
    I-JSON-Reject abgelehnt. Test-getragen und rücknahmegeprüft.
- Rest (nicht F6-blockierend): Einbau in die Codebasis; Rust-Binary im CI-Gate;
  Fuzzing der parse_strict-Grenzen; danach Promotion-Neubewertung von browser#24
  (= Marco-Gate).
