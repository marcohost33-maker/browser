# NR: Doppelte Schutzschichten machen jeden Einzelmutanten unsichtbar

- **Datum:** 2026-11-16 (im selben Durchgang gefunden und behoben, vor dem ersten Commit)
- **Ort:** `spike/tuf-offline-metadata/client/client-core.mjs` (`readVerifiedCachedTarget`)

## Was geschah

Die neue Leseregel fuer den Target-Cache entstand zuerst zweischichtig: `lstat`
(regulaere Datei, passende Groesse), danach dasselbe noch einmal auf dem geoeffneten
Deskriptor, dazu `O_NOFOLLOW` und eine Lesegrenze. Beim Entwurf der Mutanten zeigte
sich: Entfernt man eine beliebige einzelne Pruefung, faengt die jeweils andere
denselben Fall. Link, FIFO und uebergrosse Datei blieben "nicht gecacht", alle Tests
gruen. Kein Einzelmutant waere getoetet worden.

## Root-Cause

Schichten wurden addiert, weil jede fuer sich plausibel war, ohne zu fragen, welchen
Fall genau diese Schicht als einzige abdeckt. Zwei Pruefungen fuer denselben Fall
sind im Test nicht unterscheidbar; die Studie kann dann nicht belegen, dass eine von
beiden wirkt, und eine spaetere Aenderung kann eine davon still entfernen.

## Regel

Vor dem Schreiben eines Mutanten je Pruefzeile fragen: Welcher Test wird rot, wenn
genau diese Zeile fehlt? Gibt es keinen, ist die Zeile entweder ueberfluessig oder
ihr Fall fehlt im Test. Hier: auf EINE deskriptorgebundene Entscheidung reduziert
(oeffnen ohne Link-Folgen und nicht blockierend, regulaere Datei, begrenzt lesen).
Das ist zugleich die Variante ohne Fenster zwischen Pruefung und Lesen.

## Rest

Eine Zeile hat weiterhin keinen eigenen Mutanten: die Pruefung "regulaere Datei"
auf dem Deskriptor. Ihr eigener Fall waere ein FIFO mit verbundenem Schreiber.
Sie ist als benannte Grenze gefuehrt, nicht als belegt. Das nicht-blockierende
Oeffnen hat seit dem haengefesten FIFO-Test einen Mutanten
(`hanging-test-is-not-a-failing-test.md`).
