# PR/NR-Register · browser

**Zweck.** Positiv-Results (PR) und Negativ-Results (NR) ernten, damit Wissen nicht fluechtig ist.

- **PR:** was funktioniert hat + warum (wiederverwendbar).
- **NR:** was gescheitert ist + Root-Cause (Wiederholungsfehler vermeiden).

Ablage: `pr_nr/PR/<slug>.md` bzw. `pr_nr/NR/<slug>.md`.

## Register

| Datum | Typ | Slug | Kurz | Root-Cause / Nutzen |
|-------|-----|------|------|---------------------|
| 2026-11-16 | NR | [`agreeing-rejections-for-the-wrong-reason`](NR/agreeing-rejections-for-the-wrong-reason.md) | Neue Rollback-Faelle: python-tuf "lehnte ab" mit `RuntimeError` (API-Bedienfehler des Orakel-Skripts), der Vergleich meldete PASS | Vergleich pruefte Entscheidung statt Grund; jetzt Accept-Kontrolle je Gruppe, erwartete Fehlerklasse, Bedienfehler-Klassen nie gueltig |
| 2026-11-16 | NR | [`hanging-test-is-not-a-failing-test`](NR/hanging-test-is-not-a-failing-test.md) | Neuer FIFO-Test liess die Mutationsstudie haengen (bestehender Mutant `client-write-in-place` oeffnet den FIFO blockierend) | Test konnte nur bestehen oder haengen; blockierende Faelle laufen jetzt in einem Kindprozess mit hartem Zeitlimit |
| 2026-11-16 | NR | [`redundant-guards-hide-mutants`](NR/redundant-guards-hide-mutants.md) | Cache-Leseregel zuerst doppelt gebaut (lstat-Pruefung UND Deskriptor-Pruefung, Groessenvergleich UND Lesegrenze); jeder Einzelmutant haette ueberlebt | Schichten ohne eigenen Fall addiert; auf EINE deskriptorgebundene Pruefung reduziert, jede Zeile hat jetzt einen toetbaren Mutanten |
| 2026-11-16 | PR | [`kill-matrix-across-two-directories`](PR/kill-matrix-across-two-directories.md) | Kill-Matrix fuer `download` ueber Metadaten- und Target-Verzeichnis, 35 Punkte, Kopplungs-Invariante T2 | Bestaetigte den vermuteten Temp-Defekt mit Zahlen; das Nachdenken ueber "was liegt am Ausgabepfad" fand drei weitere Luecken (Link, 2 GiB, FIFO) |
| 2026-11-10 | PR | [`alice-model-instead-of-blocked-fuse`](PR/alice-model-instead-of-blocked-fuse.md) | Stromausfall-Zustaende aus aufgezeichneten Operationen nach ALICE-Modell, 43 Zustaende, K6 | Luecke trotz blockierter FUSE-Emulation geschlossen; 3 fsync-Mutanten nur so sichtbar |
| 2026-11-10 | NR | [`diagnostic-counted-placeholder-rows`](NR/diagnostic-counted-placeholder-rows.md) | Doppel-Kill-Diagnose zaehlte Platzhalterzeilen (163 statt 162) | Zahl aus Zeilenzahl statt aus Ereignis abgeleitet und vor Berichtsauswertung uebernommen |
| 2026-11-10 | PR | [`real-kill-matrix-per-syscall`](PR/real-kill-matrix-per-syscall.md) | SIGKILL vor jedem FS-Schritt eines Refresh, 86 Punkte, frischer Beobachterprozess | Fand zwei Fehler, die simulierte Abbrueche prinzipiell nicht sehen (Temp-Leichen, Fehlercode); per Mutanten trennscharf belegt |
| 2026-11-10 | NR | [`test-seam-after-the-guard`](NR/test-seam-after-the-guard.md) | Versuchszaehler stand hinter der Grenzpruefung; zwei Retry-Mutanten ueberlebten trotz gruener Tests | Naht dort gesetzt, wo bequem, nicht wo das Ereignis beginnt; jede Naht braucht einen Mutanten |
| 2026-11-03 | NR | [`node-test-directory-argument`](NR/node-test-directory-argument.md) | `node --test tests/tuf/` lief als *eine* fehlschlagende Datei; jede Mutante sah "getoetet" aus | Kontrolllauf ohne Mutation fehlte; immer zuerst die unmutierte Kontrolle messen und Dateien explizit uebergeben |
| 2026-11-03 | NR | [`reset-marker-names-new-root`](NR/reset-marker-names-new-root.md) | TUF-Reset-Marker ueberschrieb bei einem spaeteren Root den offenen Reset (C5) | Marker-Semantik "ab wann offen" mit "welcher Root kommt" verwechselt; Absturz zwischen zwei Writes nicht fuer Ketten von Refreshes durchgespielt |
| 2026-11-03 | NR | [`leaf-only-directory-check`](NR/leaf-only-directory-check.md) | Kontogrenze pruefte nur das Blattverzeichnis; Doku behauptete "andere Konten erzwungen" | Bedrohung (Umbenennen im Elternordner) nicht bis zum Ende gedacht; Standardregel CERT FIO15-C nicht vor dem Entwurf recherchiert |
| 2026-11-03 | NR | [`spec-citation-from-secondary-source`](NR/spec-citation-from-secondary-source.md) | Spec-Abschnitt 5.4.3.2 aus #59 uebernommen; richtig ist 5.4.3.1 | Abschnittsnummer aus PR-Text statt aus dem Spezifikations-Quelltext uebernommen |
| 2026-11-03 | PR | [`equivalence-instead-of-unprovable-claim`](PR/equivalence-instead-of-unprovable-claim.md) | Review-Befund "lokaler Marker manipulierbar" durch Kontogrenze plus Aequivalenzbeweis geschlossen | Unbeweisbares ("Marker manipulationssicher") durch beweisbares ersetzt: "Marker kann nicht mehr als Loeschen" ueber das ganze Korpus |
