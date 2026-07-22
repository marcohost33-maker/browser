# CWAP-Strict-JSON — F6-Adjudikation (Fehlerpräzedenz P1–P4 + 5 Präzisierungssätze)

- Status: **ADJUDIZIERT — Owner-seitig (Vero), Marco-angewiesen.** Hold auf zwei Fremd-Familien AUFGEHOBEN.
- Datum: 2026-07-22
- Adjudikator: Vero (Claude Opus 4.8), Owner-Seite (Marco/Coworkerz).
- Bezug: `SPEC_v0.1.2_DRAFT.md` (D1–D4, Owner-angenommen 2026-07-19),
  `CWAP_v0.1.2-r1_ADDENDUM_FEHLERPRAEZEDENZ.md` (P1–P4, F-01..F-05),
  007-Auftrag `2026-07-21_007_AUFTRAG_cwap-fehlerpraezedenz-F6-crossfamily`.
- Ersetzt: die fail-closed-Vorbereitung `2026-07-22_007_CWAP-F6-ADJUDIKATION-VORBEREITUNG` (Skelett).

## 0. Warum jetzt owner-seitig geschlossen (Verhältnismässigkeit)

Der F6-Auftrag hielt die Präzedenz fail-closed, bis **ChatGPT UND Gemini** ein Design-Votum
liefern (Same-Family-Vorbehalt). Marco hat 2026-07-22 entschieden, F6 owner-seitig zu
absolvieren — nicht jede Design-Frage braucht beide Fremd-Familien. Das ist hier gerechtfertigt:

1. **Die Präzedenz ist NICHT sicherheitskritisch.** Der Addendum-Text selbst hält fest:
   *„Nur der ACCEPT/REJECT-Entscheid und die Kanonbytes sind sicherheitskritisch; die
   Code-Präzedenz ist Interop-/Diagnose-Vertrag."* Ein Interop-/Diagnose-Vertrag rechtfertigt
   kein Zwei-Familien-Gate.
2. **Es liegt echte Unabhängigkeits-Evidenz vor** (nicht reines Same-Family-Selbstzertifikat):
   - **Fremd-Oracle Trail-of-Bits-rfc8785** (eine NICHT-Claude-Implementation): CWAP == ToB ==
     JCS-Referenz auf 744 Accept-Fällen + 4/4 RFC-8785-Vektoren. **Diesen Turn re-verifiziert.**
   - **ChatGPT-Cross-Family-Votum** (andere Familie, OpenAI): bestätigt schließendes-`}` als
     DUPLICATE_KEY-Meldepunkt + EOF-Regel. (Gemini-Votum steht aus — nach Marco nicht erforderlich.)
   - **Referenzfreie Viert-Impl (C)**: 3468/3468 allein aus dem Normtext (Autoren-Unabhängigkeit
     auf Implementations-Ebene; die 3 Rest-Referenzstellen tilgen die 5 Sätze).

## 1. Diesen Turn tool-re-verifizierte Evidenz (2026-07-22)

| Lauf | Ergebnis | Bedeutung |
|---|---|---|
| `test_cwap_v012_r1.py` | **31/31 PASS, exit 0** | Konformitäts-Suite grün |
| `test_cross_oracle_tob.py` | **PASS** — CWAP==ToB-rfc8785==JCS, 744 Accept + 4/4 Vektoren | **Fremd-Oracle** (nicht-Claude) stimmt auf Accept-Domäne |
| `differential_pyjs.py` | **GRUEN, exit 0** (0 Divergenzen Py↔JS) | Zweite unabhängige Impl (JS) divergenzfrei |

Nicht diesen Turn re-gelaufen (ehrlich): der **Rust-Leg** (Binary im Worktree nicht kompiliert,
nur `.rs`-Source) und der **4-Wege-Lauf inkl. C** — diese stammen aus dem Evidenz-Paket
`cwap-f6-evidenz-paket-2026-07-21.zip` (3455/3455 3-Wege + 3468/3468 referenzfrei C, prior).
Korpus-Kanon-SHA-256 der Prior-Läufe: `2fa3c49a…be23` (dreifach unabhängig bestätigt).

## 2. Adjudikation Q1–Q5 (adversarial, Owner-Seite)

- **Q1 — Determinismus der Präzedenz (P1→P2→P3→P4): PASS.** Kein Positions-Kollisions-
  Gegenbeispiel konstruierbar; 3 unabhängige Legs (Py/JS/ToB) diverenzfrei + prior 4-Wege
  3455/3455 inkl. Reject-Codes. Argument: der Ein-Pass-Scanner sieht pro Position genau ein
  Token (CPython-Hook-Semantik = die Referenz DEFINIERT die Präzedenz). Rest-Risiko: kein
  formaler Vollständigkeitsbeweis — für einen Interop-/Diagnose-Vertrag akzeptabel.
- **Q2 — Vollständigkeit der Präzedenz-Abdeckung: PASS (mit ehrlichem Caveat).** Über
  3468er-Korpus + JSONTestSuite (318/318) + Hypothesis (2×500) + 28 kombinierte Q1/Q4-Vektoren
  KEINE stufenlose Verletzungsklasse gefunden. Caveat: es existiert kein formaler
  Vollständigkeits-BEWEIS; die Aussage ist empirisch (breit, aber nicht erschöpfend) — passend
  für die Vertragsklasse.
- **Q3 — Implementierungs-Unabhängigkeit: PASS.** Die C-Viert-Impl baute 3468/3468 allein aus
  dem Normtext; die 3 verbleibenden RFC-8785-Allgemeinwissen-Ableitungen werden durch die 5
  Präzisierungssätze (a)-(e) getilgt → mit deren Ratifikation ist der Normtext impl-autark.
- **Q4 — DUPLICATE_KEY am schließenden `}` + EOF: PASS.** Über alle Konstruktionen 4-Wege
  deterministisch; **ChatGPT bestätigt** die Wahl unabhängig. Satz (d) macht den EOF-Fall
  (kein `}` → INVALID_JSON) explizit.
- **Q5 — Normalisierung / Kanten: PASS.** Keine Unicode-Normalisierung (Satz (e) schließt die
  NFC/NFKC-Key-Smuggling-Klasse konstruktiv); `-0`→`0` (Satz (b)); Top-Level-Skalare zulässig
  (Satz (c)); ES/JCS-Escaping vollständig (Satz (a)). Alle 4-Wege bzw. Fremd-Oracle belegt.

## 3. Entscheid

1. **P1–P4-Fehlerpräzedenz: ANGENOMMEN** (normativ, wie im Addendum formuliert).
2. **5 Präzisierungssätze (a)–(e): RATIFIZIERT** — verankert in `SPEC_v0.1.2_DRAFT.md`
   (§ F6-Präzisierungen, Sätze a/b/c/e) + Addendum P3-Bullet (Satz d). Rein textliche
   Präzisierung, KEINE Verhaltensänderung (3 Legs diesen Turn grün).
3. **F6-Hold aufgehoben.** Kein Warten mehr auf ein Gemini-Votum für diese
   Interop-/Diagnose-Ebene. Falls Gemini später doch antwortet, wird es als
   Ergänzungs-Note nachgetragen — es blockiert nichts mehr.
4. **browser#24-Promotion: bleibt Marco-Gate.** Der F6-DESIGN-Blocker ist aufgelöst; die
   eigentliche Promotion/Merge (inkl. Rust-Binary-CI-Gate-Einbau) ist NICHT hier vergeben.

## 4. Ehrliche Grenzen

- Rust-Leg + 4-Wege-C nicht diesen Turn re-gelaufen (Prior-Evidenz-Paket) — die diesen Turn
  verifizierte Unabhängigkeit ruht auf ToB-Fremd-Oracle + Py↔JS + 31/31.
- Kein formaler Vollständigkeitsbeweis (Q2) — empirisch breit abgedeckt.
- Dies ist Veros Owner-seitiges Verdikt, KEIN Cross-Family-Zertifikat. Die Unabhängigkeit
  kommt vom Fremd-Oracle + ChatGPT + referenzfreier C-Impl, nicht von einem Zweit-Familien-Lauf.

---
*Attribution: Coworker Research / Coworkerz | Vero (Claude Opus 4.8) | 2026-07-22.
Alle „grün/PASS"-Aussagen für diesen Turn tool-belegt (Skript-Exit-Codes gesehen).*
