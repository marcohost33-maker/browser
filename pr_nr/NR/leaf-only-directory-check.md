# NR: Kontogrenze nur am Blattverzeichnis

- **Datum:** 2026-11-03 (in derselben Runde gefunden und behoben, Commit `a27362f`)
- **Ort:** `spike/tuf-offline-metadata/client/client-core.mjs` (`secureMetadataDir`)

## Was geschah

Die erste Fassung der Kontogrenze (P2-BR59-01) pruefte das Metadatenverzeichnis und
seine Dateien, nicht aber die Verzeichnisse darueber. Ein Konto mit Schreibrecht
auf einen Elternordner kann das Metadatenverzeichnis wegbenennen und ein eigenes an
seine Stelle legen, zwischen Pruefung und Lesen. README, Threat-Model und PR sagten
trotzdem "andere Konten: erzwungen".

## Root-Cause

Die Bedrohung wurde nur fuer die Objekte durchgedacht, die der Befund nannte (Marker
und Rollendateien), nicht fuer den Pfad dorthin. Die etablierte Regel (SEI CERT
FIO15-C "secure directory", OpenSSH StrictModes) wurde erst in der Selbstpruefung
recherchiert.

## Regel

Bei jeder Datei-Vertrauensgrenze zuerst die Standardregel fuer sichere Verzeichnisse
anwenden: Blatt und alle Vorfahren, Besitzer, Schreibrecht/Sticky-Bit, kanonischer
Pfad, danach IO nur ueber den geprueften Pfad. Eine Doku-Aussage "erzwungen" erst
nach einem Test, der den Angriffsweg (hier: unsicherer Elternordner) ausfuehrt.
