# NR: Spezifikationsabschnitt aus Sekundaerquelle uebernommen

- **Datum:** 2026-11-03
- **Ort:** `spike/tuf-offline-metadata/client/README.md` (Policy #55),
  Kommentar in `client-core.mjs` (Freeze-Pruefungen)

## Was geschah

PR #59 korrigierte Issue #55 von "5.4.3.1" auf "5.4.3.2"; diese Runde uebernahm das
ungeprueft. Der Spezifikations-Quelltext (`tuf-spec.md`, Tags v1.0.35 bis v1.0.37)
zeigt: die Regel "In case they are equal, discard the new timestamp metadata and
abort the update cycle" steht in Schritt 5.4.3.1; 5.4.3.2 ist die Pruefung der
Snapshot-Version. Ebenso war "5.6.6 freeze protection" falsch (5.6.5; 5.6.6 ist
"Persist targets metadata").

## Root-Cause

Abschnittsnummern wurden aus PR-Texten und Erinnerung zitiert. Die gerenderte
Spezifikation war aus der Sitzung nicht erreichbar, der Quelltext ueber
`raw.githubusercontent.com` aber schon.

## Regel

Normative Zitate immer gegen den Quelltext der gepinnten Spezifikationsversion
pruefen und Wortlaut mitzitieren; die Nummer allein ist kein Beleg.
