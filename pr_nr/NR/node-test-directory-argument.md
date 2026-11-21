# NR: `node --test <verzeichnis>` als Mutationsorakel

- **Datum:** 2026-11-03
- **Kontext:** Mutationsproben fuer den TUF-Client (P2-BR59-01, C5).

## Was geschah

Das Probenskript rief `node --test tests/tuf/` auf. Node 22 behandelt das
Verzeichnisargument als eine einzige Testdatei, die sofort scheitert
(`not ok 1 - tests/tuf`). Damit galt jede Mutante als "getoetet", auch eine
wirkungslose.

## Root-Cause

Die Probe hatte keinen Kontrolllauf ohne Mutation. Ein Orakel, das immer rot ist,
ist von einem scharfen Orakel nicht zu unterscheiden, solange man nur Mutanten misst.

## Regel

1. Vor jeder Mutationsprobe die unmutierte Kontrolle mit demselben Befehl messen; sie
   muss gruen sein (hier: 102/102).
2. Testdateien explizit uebergeben (`node --test tests/tuf/*.test.js`) oder das
   Projektskript verwenden.
3. Pro getoeteter Mutante den Namen des fehlschlagenden Tests festhalten; "irgendein
   Test rot" reicht nicht.
