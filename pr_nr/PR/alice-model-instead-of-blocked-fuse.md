# PR: Eigenes ALICE-Persistenzmodell statt blockierter FUSE-Emulation

- **Datum:** 2026-11-10 (BR64-04, zweiter Durchgang)
- **Ort:** `tests/tuf/power-loss-model.mjs`, `tests/tuf/tuf-client-power-loss.test.js`

## Was funktioniert hat

LazyFS (FUSE, verwirft ungesyncte Daten) liess sich in der Arbeitsumgebung nicht
bauen (Fremdcode-Sperre). Statt die Luecke offen zu lassen, zeichnet der Worker
die exakten Operationen eines Refresh auf (create, write mit Bytes, fsync, rename,
unlink, Verzeichnis-fsync), und ein rund 150 Zeilen kleines Modell baut daraus jeden
nach Stromausfall moeglichen Plattenzustand nach den Regeln von ALICE (OSDI 2014):
Daten erst nach Datei-fsync dauerhaft, Verzeichnisoperationen atomar, aber erst
nach Verzeichnis-fsync dauerhaft, beliebige Teilmengen offener Operationen. Jeder
Zustand wird auf die Platte gelegt und vom selben Beobachter wie die Kill-Matrix
geprueft, plus K6 (ein zurueckgekehrter Refresh ueberlebt den Stromausfall).

## Warum es wirkt

- Selbsttest am bekannten Fehlerbild (rename ohne fsync -> Datei mit Laenge 0)
  zeigt, dass das Modell die Fehlerklasse ueberhaupt sehen kann.
- Drei fsync-Mutanten, die kein SIGKILL zeigen kann, werden ueber den Vertrag
  (K1, K6) getoetet.
- Das Modell ist strenger als ext4 `data=ordered`: ein Protokoll, das hier haelt,
  haengt nicht an dateisystemspezifischen Zusagen.

## Grenze

Modelliert, nicht gemessen: keine zerrissenen Writes innerhalb eines Aufrufs, keine
Geraete, die einen Flush quittieren, ohne ihn auszufuehren. Messung (LazyFS oder
realer Power-Cut) bleibt offen.
