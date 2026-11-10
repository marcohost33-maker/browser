# ToDo · browser

Offene Faeden, datiert. Anschluss an das zentrale `OFFENE_THEMEN`-Board.
Massgeblich fuer Entscheide bleiben GitHub-Issues und ADRs; diese Liste ordnet nur.

## Offen

| Datum | Thema | Prio | Status |
|-------|-------|------|--------|
| 2026-11-03 | Unabhaengige (modellfremde) Runde auf dem Kopf von PR #64 (#55/#56/#57 + P2-BR59-01 + C5 + C6 + Vorfahren-Regel); erst danach Merge | P1 | offen |
| 2026-11-03 | Nach Merge des Konsolidierungs-PR die Drafts #58 und #59 als ersetzt schliessen (Owner) | P2 | offen |
| 2026-11-03 | Draft #49 (POUF auf TUF 1.0.36) auf v1.0.37 (2026-10-08) nachziehen oder begruenden; Delta per Spec-Quelldiff verifiziert: nur §5.6.7.1 Delegationspfad (PR #327), 1.0.35 -> 1.0.36 redaktionell | P2 | offen |
| 2026-11-03 | Activation-Store an dieselbe Regel angleichen: heute nur Weltschreibrecht (`0o002`) am Store-Root, kein Gruppenbit, keine Vorfahren (CERT FIO15-C); Regel ggf. als gemeinsames Modul | P2 | offen |
| 2026-11-03 | Extern verankerter monotoner Backstop fuer den TUF-Vertrauenszustand (Spec-Issue #107): Optionen signiertes Image, TPM-NV-Zaehler, OS-geschuetzter Speicher bewerten | P2 | offen |
| 2026-11-03 | Windows: ACL-Pruefung des Metadatenverzeichnisses (heute nur Link/Typ-Regel) | P2 | offen |
| 2026-11-04 | R46: POSIX-Zweige des Einmal-Lesens (Link, FIFO, Rechte am Deskriptor, Ersetzen nach dem Lesen) laufen nur im CI (ubuntu); Beleg dort nachtragen | P1 | offen |
| 2026-11-04 | R46: `openat2` bewertet, nicht uebernommen (`client/THREAT-MODEL.md`); wieder aufnehmen, sobald eine native Laufzeit (#23) feststeht | P3 | offen |
| 2026-11-03 | Realer Prozess-Kill fuer den TUF-Client (BR64-04): 86/86 Kill-Punkte, `tests/tuf/tuf-client-process-kill.test.js` | P2 | erledigt 2026-11-10 |
| 2026-11-10 | Stromausfall-Evidenz fuer den TUF-Client: Kill-Matrix unter einer FUSE-Schicht, die ungesyncte Daten verwirft (LazyFS), oder ueber das Persistenzmodell des Activation-Stores; zeigt, was SIGKILL nicht zeigen kann (fehlendes oder wirkungsloses `fsync`) | P2 | offen |
| 2026-11-10 | Kill-Matrix fuer `download` (Target-Cache, eigener Temp-Pfad ausserhalb des Metadatenverzeichnisses, heute ohne Sweep) und fuer die Update-Activation-Kopplung #61 | P2 | offen |
| 2026-11-10 | Zweite Sicherheitsrunde (modellfremd) auf dem Kopf mit BR64-02/BR64-04, danach Merge-Entscheid #64 (Owner) | P1 | offen |
| 2026-11-03 | #53/#54 Always-run Exact-Head-Merge-Gate: Draft seit 2026-09-30, gegen aktuellen `main` neu bewerten | P1 | offen |
| 2026-11-03 | #61 Update-Activation-Kopplung: HOLD, bis T1-Umfang, Format, Publisher und Key-Trust entschieden sind (Audit 2026-10-16) | P1 | blockiert |
| 2026-11-03 | #14 Produkt-Discovery und #30 Akquisitionsmodi: Owner-Entscheide, kritischer Pfad M1 | P0 | Owner |

> Hinweis: Erledigtes nach `archiv/` verschieben oder abhaken.
