# CWAP-Strict-JSON v0.1.2 — Normativer Kanonisierungs-Entwurf (DRAFT)

Status: DRAFT für Owner-Entscheid (Marco/Vero). Promotion bleibt fail-closed.
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

## Offen (Owner/Cross-Family)

Owner-Entscheid über D1–D4; Einbau in die v0.1.1-Codebasis (dort ersetzt
recanonicalize den bisherigen Kanonschritt); Rust-Zweitimplementation +
Differential-Korpus; Fuzzing der parse_strict-Grenzen; danach erst
Promotion-Neubewertung von browser#24.
