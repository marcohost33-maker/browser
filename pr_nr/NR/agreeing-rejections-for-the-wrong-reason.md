# NR: Uebereinstimmendes "reject" aus dem falschen Grund

- **Datum:** 2026-11-16 (im selben Durchgang gefunden und behoben, vor dem ersten Commit)
- **Ort:** `spike/tuf-offline-metadata/differential/python_tuf_oracle.py`,
  `compare-results.mjs`, `generate-corpus.mjs`

## Was geschah

Fuer die R8-Roadmap (007acc2, 2026-11-15: "Root/Target/Snapshot-Rollback
differenziell beweisen") kamen Korpusfaelle fuer Snapshot- und Targets-Rollback
dazu. Das Orakel-Skript lud den gespeicherten Snapshot VOR dem neuen Timestamp.
python-tuf antwortete darauf in allen Faellen mit
`RuntimeError: Cannot update timestamp after snapshot`. Das ist ein Bedienfehler
der API, kein Urteil ueber die Metadaten. Der Vergleich verglich nur
accept/reject: Beide Rollback-Faelle standen als PASS da, "Browser und python-tuf
lehnen ab". Aufgefallen ist es nur, weil ein Kontrollfall (neuere Kette, muss
akzeptiert werden) dabei war und fehlschlug, und weil die Fehlertexte danach
einzeln gelesen wurden.

## Root-Cause

Der Vergleich pruefte die Entscheidung, nicht ihren Grund. Ein Orakel, das aus
irgendeinem Grund eine Ausnahme wirft, sieht fuer jeden Reject-Fall wie
Uebereinstimmung aus. Ohne Positivkontrolle im selben Zustand waere das als
differenzieller Beweis in den Bericht gegangen.

## Regel

1. Jede Gruppe von Reject-Faellen bekommt eine Accept-Kontrolle im selben
   Ausgangszustand. Schlaegt sie fehl, sind die Rejects daneben nichts wert.
2. Ein Reject-Fall nennt die Fehlerklasse, die er erwartet
   (`expected_python_error`); der Vergleich prueft sie.
3. Fehlerklassen, die nur einen Bedienfehler des Orakels bedeuten, sind in keinem
   Fall eine gueltige Ablehnung (`ORACLE_MISUSE_ERRORS`).
4. Die Reihenfolge im Orakel folgt dem echten Client (`ngclient.Updater`), nicht
   der bequemsten Reihenfolge der Eingabefelder.

## Rest

Die aelteren Reject-Faelle nennen noch keine erwartete Fehlerklasse. Ihre
Klassen wurden am 2026-11-16 einzeln gelesen und passen zum jeweiligen Fall; als
Pflichtfeld nachziehen.
