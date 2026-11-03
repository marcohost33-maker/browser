# PR/NR-Register · browser

**Zweck.** Positiv-Results (PR) und Negativ-Results (NR) ernten, damit Wissen nicht fluechtig ist.

- **PR:** was funktioniert hat + warum (wiederverwendbar).
- **NR:** was gescheitert ist + Root-Cause (Wiederholungsfehler vermeiden).

Ablage: `pr_nr/PR/<slug>.md` bzw. `pr_nr/NR/<slug>.md`.

## Register

| Datum | Typ | Slug | Kurz | Root-Cause / Nutzen |
|-------|-----|------|------|---------------------|
| 2026-11-03 | NR | [`node-test-directory-argument`](NR/node-test-directory-argument.md) | `node --test tests/tuf/` lief als *eine* fehlschlagende Datei; jede Mutante sah "getoetet" aus | Kontrolllauf ohne Mutation fehlte; immer zuerst die unmutierte Kontrolle messen und Dateien explizit uebergeben |
| 2026-11-03 | NR | [`reset-marker-names-new-root`](NR/reset-marker-names-new-root.md) | TUF-Reset-Marker ueberschrieb bei einem spaeteren Root den offenen Reset (C5) | Marker-Semantik "ab wann offen" mit "welcher Root kommt" verwechselt; Absturz zwischen zwei Writes nicht fuer Ketten von Refreshes durchgespielt |
| 2026-11-03 | PR | [`equivalence-instead-of-unprovable-claim`](PR/equivalence-instead-of-unprovable-claim.md) | Review-Befund "lokaler Marker manipulierbar" durch Kontogrenze plus Aequivalenzbeweis geschlossen | Unbeweisbares ("Marker manipulationssicher") durch beweisbares ersetzt: "Marker kann nicht mehr als Loeschen" ueber das ganze Korpus |
