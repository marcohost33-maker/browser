# NR: Test-Naht hinter der Pruefung, die sie beobachten soll

- **Datum:** 2026-11-10 (in derselben Runde gefunden und behoben)
- **Ort:** `spike/tuf-offline-metadata/client/client-core.mjs` (`readSettledTrustedState`),
  `tests/tuf/tuf-client-read-retry.test.js`

## Was geschah

Der Zaehler `probes.beforeAttempt` fuer das begrenzte Neu-Lesen (BR64-02) stand
zuerst NACH der Verzeichnis-Grenzpruefung eines Versuchs. Ein Versuch, den diese
Pruefung sofort ablehnte, wurde deshalb nie gezaehlt. Folge: Zwei Mutanten
ueberlebten die volle Studie (`client-load-retries-insecure-state`,
`client-load-retry-reuses-directory-check`), obwohl die Tests "nur ein Versuch"
und "Verzeichnis wird neu geprueft" behaupteten und gruen waren.

## Root-Cause

Die Naht wurde dort eingesetzt, wo sie bequem war (vor dem Lesen), nicht dort, wo
das beobachtete Ereignis beginnt (am Anfang des Versuchs). Die Tests prueften die
Naht, nicht den Versuch.

## Regel

Eine Zaehl- oder Beobachtungsnaht steht VOR allem, was das gezaehlte Ereignis
abbrechen kann. Jede neue Naht bekommt einen Mutanten, der genau das Verhalten
entfernt, das die Naht beweisen soll; ueberlebt er, misst die Naht das Falsche.
