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

## Offen (Owner/Cross-Family)

- Owner-Entscheid über D1–D4: **ANGENOMMEN 2026-07-19** (`DECISION_2026-07-19.md`).
- P1–P4-Fehlerpräzedenz + F6-Präzisierungen (a)–(e): **ADJUDIZIERT 2026-07-22**
  (Vero owner-seitig, Marco-angewiesen; Fremd-Oracle + ChatGPT-Votum als
  Unabhängigkeits-Anker) — `ADJUDICATION_F6_2026-07-22.md`. Der frühere „warte auf
  ChatGPT UND Gemini"-Hold ist damit AUFGEHOBEN: die Präzedenz ist laut Addendum
  ausdrücklich **Interop-/Diagnose-Vertrag, nicht sicherheitskritisch** (nur
  ACCEPT/REJECT + Kanonbytes sind sicherheitskritisch, und die sind durch das
  Fremd-Oracle unabhängig bestätigt).
- Rest (nicht F6-blockierend): Einbau in die Codebasis; Rust-Binary im CI-Gate;
  Fuzzing der parse_strict-Grenzen; danach Promotion-Neubewertung von browser#24
  (= Marco-Gate).
