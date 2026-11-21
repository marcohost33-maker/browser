# NR: Diagnosezeile zaehlte Platzhalterzeilen als Messpunkte

- **Datum:** 2026-11-10 (in derselben Runde gefunden und behoben)
- **Ort:** `tests/tuf/tuf-client-process-kill.test.js` (Doppel-Kill-Matrix)

## Was geschah

Die Doppel-Kill-Matrix legt fuer einen ersten Absturzzustand ohne
Recovery-Schritte eine Zeile `no-recovery-steps` an (nichts zu unterbrechen). Die
Diagnose zaehlte alle Zeilen als "recovery kills": 163 statt 162 im Standardlauf,
187/452/479 statt 186/451/478 im vollstaendigen Lauf. Die Zahl stand bereits in
CHANGELOG und Threat Model, bevor die Auswertung des Berichts sie widerlegte.

## Root-Cause

Eine Zaehlung wurde aus der Zeilenzahl abgeleitet statt aus dem gezaehlten
Ereignis, und die erste Zahl wurde uebernommen, bevor der Bericht sie bestaetigte.

## Regel

Zahlen in Doku nur aus dem maschinenlesbaren Bericht, gefiltert auf das
Ereignis; Platzhalter- und Kontrollzeilen nie mitzaehlen.
