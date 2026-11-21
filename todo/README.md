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
| 2026-11-04 | R46: POSIX-Zweige des Einmal-Lesens (Link, FIFO, Rechte am Deskriptor, Ersetzen nach dem Lesen) laufen nur im CI (ubuntu); Beleg: Lauf 42798074801 (#66, `ubuntu-latest`, ohne Root), alle gruen | P1 | erledigt 2026-11-10 |
| 2026-11-04 | R46: `openat2` bewertet, nicht uebernommen (`client/THREAT-MODEL.md`); wieder aufnehmen, sobald eine native Laufzeit (#23) feststeht | P3 | offen |
| 2026-11-03 | Realer Prozess-Kill fuer den TUF-Client (BR64-04): 86/86 Kill-Punkte, `tests/tuf/tuf-client-process-kill.test.js` | P2 | erledigt 2026-11-10 |
| 2026-11-10 | Stromausfall fuer den TUF-Client modelliert (ALICE-Modell, 43 Zustaende, K6, 3 fsync-Mutanten): `tests/tuf/tuf-client-power-loss.test.js` | P2 | erledigt 2026-11-10 |
| 2026-11-10 | Gemessene Stromausfall-Evidenz: dieselben Szenarien unter LazyFS (FUSE, verwirft ungesyncte Daten; Build braucht libfuse3, im Cloud-Container blockiert als Fremdcode) oder ein realer Power-Cut-Drill auf Zielhardware | P2 | offen |
| 2026-11-10 | Doppelabsturz (Kill waehrend Recovery) und Bootstrap-Kill: `tests/tuf/tuf-client-process-kill.test.js` | P2 | erledigt 2026-11-10 |
| 2026-11-10 | Kill-Matrix fuer `download` (Target-Cache, eigener Temp-Pfad ausserhalb des Metadatenverzeichnisses): 35 Kill-Punkte, Stromausfall-Modell, Sweep und Cache-Leseregel, `tests/tuf/tuf-client-download-kill.test.js`, `tests/tuf/tuf-client-target-cache.test.js` | P2 | erledigt 2026-11-16 |
| 2026-11-16 | Rollback differenziell gegen python-tuf (R8-Roadmap): Snapshot, Targets, Root-Version, Accept-Kontrolle; Korpus 23 Faelle, 0 Abweichungen; Vergleich prueft den Ablehnungsgrund | P0 | erledigt 2026-11-16 (lokal; CI-Lauf am Merge-Objekt steht aus) |
| 2026-11-16 | Differential: `expected_python_error` fuer alle aelteren Reject-Faelle zur Pflicht machen (heute nur die Rollback- und Root-Versions-Faelle) | P2 | erledigt 2026-11-18 (A7-R14: dazu `expected_browser_code`, `positive_control` mit gleichem Orakel-Setup, python-Fehlerkategorie `repository`/`oracle-fault`; Korpus 24 Faelle) |
| 2026-11-16 | Differential: Fast-Forward-Recovery (5.3.11) ueber den vollen `ngclient.Updater` mit lokalem Verzeichnis statt `TrustedMetadataSet` vergleichen | P2 | offen |
| 2026-11-16 | Kill-Matrix fuer die Update-Activation-Kopplung #61 (haengt an deren HOLD) | P2 | blockiert |
| 2026-11-16 | `download` mit mehreren Targets in einem Aufruf: Kill zwischen zwei Targets (heute nur ein Target je Matrix-Lauf) | P3 | offen |
| 2026-11-16 | Stromausfall-Modell auf mehrere Verzeichnisse erweitern (Anlegen neuer Target-Verzeichnisse; heute nur per Spur-Pruefung der Verzeichnis-Syncs belegt) | P3 | offen |
| 2026-11-16 | #64 wurde am 2026-11-16 mit `main` (`8bc0ef5`) zusammengefuehrt und neu getestet (492 Tests, 0 Fehler); CI-Lauf auf dem Merge-Objekt und modellfremde Runde bleiben Voraussetzung fuer den Merge (R8-Roadmap 007acc2) | P1 | offen |
| 2026-11-10 | Zweite Sicherheitsrunde (modellfremd) auf dem Kopf mit BR64-02/BR64-04, danach Merge-Entscheid #64 (Owner) | P1 | offen |
| 2026-11-03 | #53/#54 Always-run Exact-Head-Merge-Gate: Draft seit 2026-09-30, gegen aktuellen `main` neu bewerten | P1 | offen |
| 2026-11-03 | #61 Update-Activation-Kopplung: HOLD, bis T1-Umfang, Format, Publisher und Key-Trust entschieden sind (Audit 2026-10-16) | P1 | blockiert |
| 2026-11-03 | #14 Produkt-Discovery und #30 Akquisitionsmodi: Owner-Entscheide, kritischer Pfad M1 | P0 | Owner |

> Hinweis: Erledigtes nach `archiv/` verschieben oder abhaken.
