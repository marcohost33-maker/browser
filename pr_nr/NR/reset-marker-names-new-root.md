# NR: Reset-Marker benennt den neuen statt den offenen Root (C5)

- **Datum:** 2026-11-03
- **Ort:** `spike/tuf-offline-metadata/client/client-core.mjs`
  (`rollbackResetSinceRoot`), Test C5 in `tests/tuf/tuf-client-cli.test.js`.

## Was geschah

Der #59-Marker `rollback-reset.json` schrieb bei jedem Refresh unter Reset die
Version des NEUEN Roots. Lief ein Refresh unter einem bereits offenen Reset (Marker
fuer Root v2 nach einem Absturz) und brachte das Repository inzwischen Root v3, wurde
der Marker auf v3 gesetzt, bevor `root.json` v3 lag. Ein Absturz dazwischen hinterliess
einen Marker fuer einen Root, der neuer ist als der auf der Platte; der Loader haelt
das fuer einen nie abgeschlossenen Refresh und ignoriert ihn. Der vorgespulte
Snapshot-Floor kam zurueck, jeder weitere Refresh scheiterte mit `SNAPSHOT_ROLLBACK`.

## Root-Cause

Zwei Bedeutungen in einem Feld: "seit welchem Root ist der Reset offen" (bestimmt,
ob er gilt) und "welcher Root wird gerade geschrieben". Die bestehende Crash-Matrix
(C1 bis C4) spielte Abstuerze innerhalb EINES Refreshs durch, nicht eine Kette von
zwei Refreshs mit einem Root-Update dazwischen.

## Regel

Crash-Matrizen fuer persistente Marker immer auch ueber zwei aufeinanderfolgende
Laeufe fuehren, in denen sich die Eingabe (hier: der Root) aendert.
