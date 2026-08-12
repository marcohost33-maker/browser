# Daten-Klassifikation · browser

Schutzklassen-Modell (5-Tier). Repo-Default: **T0 (oeffentlich)**.

| Tier | Bedeutung | Beispiel | Behandlung |
|------|-----------|----------|------------|
| T0 | oeffentlich | veroeffentlichte Docs | keine |
| T1 | intern | interne Notizen | Repo privat |
| T2 | vertraulich | Kunden- / Projektdaten | Zugriff minimieren |
| T3 | geheim | Secrets / Keys | nie im Klartext, nie committen |
| T4 | reguliert | personenbezogen / PII | Rechts- / DS-Register pflichtig |

## Repo-Einstufung

- Hoechste hier verarbeitete Klasse: **T0 (oeffentlich)**
- Datum der Einstufung: 2026-08-13, zusammen mit der Umstellung auf `public`
- Begruendung: Das Repository enthaelt ausschliesslich Quellcode, Tests,
  Architektur-Entscheide (ADRs), Sicherheits-Rationale und Evidenz-Artefakte
  zur eigenen statischen Sicherheits-Baseline. Es verarbeitet **keine**
  Nutzer-, Kunden- oder Personendaten, haelt **keine** Betriebsgeheimnisse und
  fuehrt **keine** Zugangsdaten. Es gibt keinen Laufzeit-Dienst, keine
  Datenbank und keine Telemetrie — die Baseline verbietet Reporting-Header
  ausdruecklich.

## Was diese Einstufung ausdruecklich NICHT bedeutet

Ein T0-Repository ist nicht dasselbe wie ein freigegebenes Produkt. Das
Produktions-Gate der Readiness-Matrix ist offen; oeffentlich ist die laufende
Arbeit samt ihrer offenen Entscheidungen und unfertigen Gates.

## Grenzen, die aus der Veroeffentlichung folgen

Ab 2026-08-13 ist das Repository oeffentlich. Damit gilt fuer alle kuenftigen
Beitraege eine Eingangs-, keine Ausgangskontrolle:

1. **Die Historie ist nicht mehr korrigierbar.** Ein einmal gepushtes Geheimnis
   ist offengelegt, auch wenn der Commit spaeter entfernt wird — geklonte,
   gecachte und indizierte Kopien bleiben. Der einzig wirksame Weg ist
   **rotieren**, nicht loeschen.
2. **T1-Material gehoert nicht hierher.** Interne Notizen, Betriebs-Interna und
   Material ueber Dritte sind in diesem Repo ab jetzt fehl am Platz, auch wenn
   sie technisch harmlos sind.
3. **Schwester-Repositories bleiben privat.** `nigin-engine` und
   `browser-nigin` werden in Dokumenten hier namentlich genannt und in ihrer
   Rolle beschrieben. Ihre Existenz und Teile ihrer Entscheidungshistorie sind
   damit oeffentlich; ihre Inhalte nicht. Beitraege duerfen das nicht
   ausweiten.
4. **T3/T4 ist hier unzulaessig**, nicht nur unerwuenscht. Secret Scanning mit
   Push Protection ist der technische Wachposten dafuer; er ersetzt aber nicht
   die Regel, dass solches Material gar nicht erst entsteht.

## Aenderungs-Protokoll

- 2026-08-13 — Erst-Einstufung T0 im Zuge der Umstellung auf `public`. Vorher
  war das Dokument ein unausgefuelltes Template (`<hier einstufen>`), obwohl es
  genau die Frage beantworten soll, ob dieses Repository oeffentlich sein darf.
