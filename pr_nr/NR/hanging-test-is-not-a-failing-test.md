# NR: Ein Test, der nur bestehen oder haengen kann

- **Datum:** 2026-11-16 (im selben Durchgang gefunden und behoben, vor dem ersten Commit)
- **Ort:** `tests/tuf/tuf-client-target-cache.test.js` (FIFO-Test),
  `spike/tuf-offline-metadata/differential/mutation-study.mjs`

## Was geschah

Der neue Test "ein FIFO am Ausgabepfad blockiert den Download nicht" rief
`downloadTargets()` im Testprozess auf, mit `timeout` von `node:test`. Die volle
Mutationsstudie blieb danach stehen: ueber 11 Minuten ohne Fortschritt. Ursache
war nicht einer der neuen Mutanten, sondern der bestehende `client-write-in-place`:
Er oeffnet den Ausgabepfad zum Schreiben, beim FIFO blockiert das ohne Leser fuer
immer. Ein blockierender `open` parkt einen Thread des Threadpools; das
Test-Timeout markiert den Test, beendet aber den Prozess nicht.

Das Risiko war beim Schreiben des Tests bekannt, wurde aber nur fuer die EIGENEN
Mutanten bedacht (einer wurde deshalb bewusst nicht-blockierend formuliert).

## Root-Cause

Ein Test fuer "blockiert nicht" hat im selben Prozess nur zwei Ausgaenge: gruen
oder Haenger. Ein Haenger ist kein Fehlschlag: Die Studie wertet ihn nicht als
Kill, und im CI frisst er das Zeitbudget des ganzen Jobs.

## Regel

Ein Test, dessen Fehlerfall "blockiert" heisst, fuehrt den Pruefling in einem
Kindprozess mit hartem Zeitlimit und SIGKILL aus und prueft, dass kein Signal
noetig war. Nach jedem neuen Test dieser Art die VOLLE Studie laufen lassen, nicht
nur die neuen Mutanten: Bestehende Mutanten treffen neue Tests.

## Folge

Der FIFO-Test laeuft jetzt ueber `process-kill-worker.mjs` (Modus `download`,
20 s Limit). Damit wurde auch ein Mutant fuer das nicht-blockierende Oeffnen
moeglich (`client-target-cache-blocking-open`), der vorher als "nicht testbar"
gefuehrt war.
