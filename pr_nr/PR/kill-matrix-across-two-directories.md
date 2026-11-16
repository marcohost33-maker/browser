# PR: Kill-Matrix ueber zwei Verzeichnisse mit Kopplungs-Invariante

- **Datum:** 2026-11-16 (offener Punkt aus `todo/` vom 2026-11-10)
- **Ort:** `tests/tuf/tuf-client-download-kill.test.js`, `tests/tuf/process-kill-worker.mjs`
  (Modi `download`, `after-download-crash`), `tests/tuf/tuf-client-target-cache.test.js`

## Was funktioniert hat

Die Instrumentierung der Refresh-Matrix (jeder Dateisystemschritt nummeriert, vor
der Ausfuehrung geloggt, SIGKILL vor Schritt k) wurde unveraendert um einen
`download`-Modus ergaenzt. Dadurch sind die Schritte im Target-Verzeichnis
automatisch Kill-Punkte, ohne den Produktivcode anzufassen. Neu ist der Vertrag
ueber BEIDE Verzeichnisse, vor allem die Kopplung **T2**: Das neue Target darf nur
unter vollstaendig geschriebenen neuen Metadaten auf der Platte liegen.

## Warum es wirkt

- **Erst rot, dann Fix.** Die Matrix lief zuerst gegen den unveraenderten Client:
  3 von 9 und 3 von 26 Kill-Punkten sowie ein Stromausfall-Zustand verletzten "kein
  Temp bleibt". Der in `todo/` nur vermutete Defekt hatte damit Zahlen.
- **Zwei Szenarien mit verschiedenem Ausgangszustand.** "Verzeichnisse existieren
  nicht" prueft das Anlegen samt Verzeichnis-Syncs; "gecachtes altes Target" prueft
  das Ersetzen und die Kopplung an ein Metadaten-Update im selben Aufruf.
- **Altes Verhalten einzeln gemessen.** Fuer Link, 2-GiB-Datei und FIFO lief ein
  Wegwerf-Skript gegen den Client-Stand vor der Aenderung (Cache-Treffer durch den
  Link; `ERR_FS_FILE_TOO_LARGE`; Abbruch erst durch `timeout` nach 20 s). Die
  Aussage "vorher gemessen" im Threat-Model stammt daher, nicht aus der Lektuere.
- **Mutanten je Regel.** Vier neue, je von genau dem vorgesehenen Test getoetet.

## Grenze

Ein Target je Aufruf. Das Stromausfall-Modell kennt ein Verzeichnis; das Anlegen
neuer Target-Verzeichnisse ist nur ueber die Spur (Sync jedes Verzeichnisses, das
einen Eintrag bekam) belegt. SIGKILL laesst den Page-Cache stehen.
