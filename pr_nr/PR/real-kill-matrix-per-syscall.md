# PR: Echte Kill-Matrix je Dateisystemschritt statt simulierter Abbrueche

- **Datum:** 2026-11-10 (BR64-04, Cross-Family-Runde zu #64)
- **Ort:** `tests/tuf/process-kill-worker.mjs`, `tests/tuf/tuf-client-process-kill.test.js`

## Was funktioniert hat

Ein Kindprozess ersetzt `open`/`rename`/`unlink`/`mkdir` von `node:fs/promises`
und die `writeFile`/`sync`-Methoden der zurueckgegebenen Handles, uebernimmt das per
`syncBuiltinESMExports()` in die ESM-Bindungen des Produktivcodes (ohne dessen
Quelltext anzufassen) und schreibt jeden Schritt synchron ins Log, BEVOR er
laeuft. Ein Lauf ohne Kill liefert die Schrittfolge; danach je ein Lauf mit
SIGKILL vor Schritt k (und nach dem letzten). Ein frischer Prozess beobachtet den
Zustand, bevor er schreibt. Der Vertrag (alt / neu / verweigert, kein Floor-Verlust,
konvergente Recovery, kein Temp) wird an jedem Punkt geprueft.

## Warum es wirkt

- Die simulierten Abbrueche warfen in einem Prozess, dessen `finally`-Bloecke
  weiterliefen: Temp-Leichen waren so prinzipiell unsichtbar. Der echte Kill fand
  sie sofort, ebenso einen uneinheitlichen Fehlercode im Read-back.
- Schritte werden per Namen und Reihenfolge verglichen (der getoetete Lauf muss
  der Spur folgen), sodass eine geaenderte Schreibfolge nicht still eine andere
  Matrix misst.
- Drei Mutanten belegen, dass die Matrix trennscharf ist (In-Place-Write,
  liegengelassene Temps, Fehlercode).

## Grenze

SIGKILL laesst den Page-Cache stehen. Fuer fehlende `fsync` braucht es eine
Stromausfall-Emulation (FUSE wie LazyFS oder ein Persistenzmodell wie im
Activation-Store).
