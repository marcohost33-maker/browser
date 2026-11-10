# Changelog

Alle nennenswerten Aenderungen an diesem Projekt werden hier dokumentiert.

Format nach [Keep a Changelog 1.1](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [SemVer](https://semver.org/lang/de/).

## [Unreleased]

### Added

- Scaffold aus `code-factory` Copier-Template (14-Element-Struktur).
- Formatneutraler Activation-Store als Spike fuer ADR-007a Abschnitt 6
  (`spike/activation-store/`): content-adressierte, unveraenderliche Objekte statt
  entpackter Paketpfade (Traversal-, Symlink-, Reparse- und Case-Kollisionsklassen
  entfallen konstruktiv), genau ein atomarer Commit-Punkt `state/CURRENT`,
  Compare-and-Swap auf der Generation, Last-Good-Retention gebunden an den
  autoritativen Commit-Datensatz statt an Dateinamen (schliesst P1-RECOVERY-1 aus dem
  CWAP-v0.1.1-Review; P1-RECOVERY-2 entfaellt durch Content-Adressierung),
  deterministischer Rollback, Commit-Bindings fuer Update-Metadaten im selben
  atomaren Schritt und eine Recovery, die Barrieren wiederherstellt und nie selbst
  Versionen wechselt. Keine Formatwahl, kein Installer, keine Runtime-Anbindung.
  **Evidenz:** Crash-Matrix ueber Prozess-Crash-, POSIX-strikte und
  geordnete-Journal-Persistenzmodelle in drei Plattformvarianten (POSIX-
  Verzeichnisbarriere, NTFS-Journal-Hypothese, keine Barriere): 58'078/58'078
  Crash-Faelle konsistent, 0 Durability-Verletzungen, 4/4 Negativkontrollen
  erkannt, 312/312 reale Prozess-Crashes (Linux); 18/18 Kontroll-Mutationen
  getoetet; Report byteweise reproduzierbar und an die exakten Quell-Digests
  gebunden. Die Matrix fand echte Durability-Fehler im eigenen Entwurf
  (Initialisierung, sichtbarer aber nicht dauerhafter Marker, Barrierenreihenfolge,
  Commit-Abhaengigkeit von der Staging-Historie), alle behoben.
  **Haertung nach Review (2026-09-29):** jeder Commit stellt die Verzeichnis-
  barrieren aller referenzierten Objekte selbst her (haengt nicht mehr davon ab,
  wie die Objekte entstanden sind); `durable_rename` vollstaendig (Datei-fsync unter
  dem neuen Namen, dann Verzeichnis), womit auch Windows ohne Verzeichnis-fsync eine
  Barriere hat und der Store meldet, welche gehalten hat (`directory-fsync`,
  `file-fsync-only`, `unavailable`); Verifikation streamt Objekte statt sie zu
  laden; Store-Root eines fremden Kontos wird abgelehnt; Leser wiederholen eine
  Aufloesung genau einmal gegen einen zwischenzeitlich bewegten Commit.
  **Neu:** Workflow `activation-store-ci` (advisory, pfadgefiltert) mit Tests,
  Plattform-Sonde, realer Prozess-Crash-Matrix und ADR-007a-§9-Benchmark auf
  Linux, Windows und macOS; Benchmark-Reports als Artefakte.
  **Messung (ADR-007a §9, `bench.mjs`):** p50/p95-Latenz von Stage, Activate,
  Verify, Read, Open/Stream und Recover sowie Spitzenspeicher ueber sechs
  Paketformen entlang des Ressourcen-Envelopes (200 KiB bis 512 MiB, 1 bis 10'000
  Objekte). Befunde und Behebung: `readResource` allozierte pro Lesen das ganze
  Objekt (129 MiB Puffer bei 64 MiB) -> neue Primitive `openResource` verifiziert
  ueber ein einziges Handle vor dem ersten Byte und streamt danach aus demselben
  Handle; jedes Lesen validierte den kompletten Versionsdatensatz neu (99 ms bei
  10'000 Ressourcen) -> Cache validierter, content-adressierter Datensaetze nur
  fuer den Servierpfad, Commits/Verifikation/Recovery/GC lesen weiterhin von der
  Platte. Staging ist fsync-gebunden: pro Objekt 0.7-1.0 ms auf ext4
  (Hosted-Runner), 1.8-2.8 ms auf ext4 (Mess-VM) und APFS, 9-12 ms auf NTFS;
  10'000 Objekte kosten 6.5 s / 18 s / 92 s, waehrend Verifikation grosser Objekte
  ueberall bei 850-1'170 MiB/s liegt -- ein Messwert fuer den D4-Containerentscheid
  (wenige Store-Objekte pro Container) und fuer die Installer-UX auf Windows.
  **Offen:** Stromausfall-Evidenz auf Windows/macOS (NTFS-Journal-Hypothese ist
  modelliert, nicht gemessen), realer Stromausfall-Drill, Messung auf Zielhardware
  statt Hosted-Runnern, Installer-Anbindung nach dem D4-Containerentscheid.

### Security

- TUF-Client-Spike, Selbstpruefung der BR64-Runde (2026-11-10, zweiter Durchgang),
  fuenf Luecken geschlossen:
  1. **Stromausfall statt nur Prozess-Kill:** SIGKILL laesst den Page-Cache stehen
     und kann ein fehlendes `fsync` nicht zeigen. Neu
     `tests/tuf/tuf-client-power-loss.test.js` mit eigenem Persistenzmodell nach
     ALICE (OSDI 2014, `tests/tuf/power-loss-model.mjs`): exakte Operationen eines
     Refresh aufzeichnen, jeden nach Stromausfall moeglichen Plattenzustand bauen
     (Daten erst nach Datei-`fsync`, Verzeichnisoperationen erst nach
     Verzeichnis-`fsync` dauerhaft, beliebige Teilmengen der offenen). Neue
     Eigenschaft **K6**: nach Rueckkehr des Refresh ist jeder Stromausfall-Zustand
     genau der neue. Ergebnis: 82 Operationen, 43 verschiedene Zustaende, K1-K6
     halten. Selbsttest des Modells am klassischen Null-Laengen-Fehler (rename ohne
     `fsync`). Drei neue Mutanten (Datei-`fsync`, Verzeichnis-`fsync`,
     Marker-Loeschung ohne Verzeichnis-`fsync`) – nur ein Stromausfall zeigt sie;
     alle getoetet. LazyFS war vorgesehen, sein Build ist in der verwendeten
     Umgebung als Fremdcode nicht erlaubt; als naechster Schritt eingetragen.
  2. **Doppelabsturz:** zweiter SIGKILL waehrend der Recovery jedes
     unterschiedlichen ersten Absturzzustands: im Standardlauf (Rotation mit
     Reset, jeder dritte Recovery-Schritt und der letzte) 162 Recovery-Kills aus 16
     Zustaenden; vollstaendig (`BROWSER_TUF_CRASH_EXHAUSTIVE=1`, alle drei
     Szenarien, jeder Schritt) **1'115 Recovery-Kills aus 43 Zustaenden, alle
     vertragsgemaess** (232 s, lokal).
  3. **Bootstrap:** Kill an jedem Schritt von `initClient` (9 Punkte): nie ein
     zerrissenes `root.json`; erneutes `init` vervollstaendigt, ein vorhandener Root
     wird nicht ersetzt; der erste Refresh verifiziert und raeumt Temps.
  4. **Drift-Waechter des Harness:** jede Ersetzung einer Rollendatei muss als
     create -> write -> fsync -> rename -> Verzeichnis-fsync in der Spur stehen;
     faellt ein Hook still weg, schlaegt der Lauf fehl statt die Matrix zu
     verkleinern. Fehlgeschlagene Schritte (unlink eines fehlenden Markers) werden
     als solche protokolliert.
  5. **Belege:** CI-Lauf 42798074801 (`ubuntu-latest`, ohne Root) zeigt die
     Kill-Matrix und 40/40 Mutanten am Kopf `ab80620`; `security-ci`/`docs-ci`
     laufen fuer einen gestapelten PR (Basis nicht `main`) nicht – dort gilt nur
     der lokale Lauf.
  Gemeinsame Szenarien und Vertragspruefung in `tests/tuf/crash-matrix-support.mjs`.
  Mutationsstudie 40 -> 43; die Doppel-Kill-Matrix laeuft in der Studie nicht
  (kein Mutant braucht sie als Detektor).
- TUF-Client-Spike, offene Punkte der Cross-Family-Runde zu #64 (2026-11-05,
  `SECURITY_REVIEW_REQUIRED`):
  1. **BR64-04 – echte Prozess-Kills statt nur simulierter Abbrueche:**
     `tests/tuf/tuf-client-process-kill.test.js` startet einen Refresh als eigenen
     Prozess (`process-kill-worker.mjs`) und beendet ihn per SIGKILL vor jedem
     einzelnen Dateisystemschritt (`mkdir`, `create`, `write`, `fsync`, `rename`,
     Verzeichnis-`fsync`, `unlink`) und nach dem letzten. Ein frischer Prozess
     liest danach den hinterlassenen Zustand, bevor er irgendetwas schreibt.
     Vertrag K1–K5 (`client/THREAT-MODEL.md`, "Crash evidence"): keine zerrissene
     Datei; offline wird genau der alte oder der neue vollstaendige Stand
     verifiziert, alles dazwischen mit `PERSISTED_STATE_UNVERIFIED` verweigert;
     ein Replay des alten Buendels gewinnt nie; eine Recovery erreicht genau den
     neuen Stand, die zweite ist ein `no-update`; kein Temp bleibt. Drei
     Szenarien (Update v2→v3, Root-Rotation mit 5.3.11-Reset, Rotation ueber einen
     auf 99999 vorgespulten Targets-Floor): **86/86 Kill-Punkte** vertragsgemaess
     (Linux). Grenze: SIGKILL laesst den Page-Cache stehen; ein fehlendes `fsync`
     zeigt nur eine Stromausfall-Emulation (offen).
     Die Matrix fand **zwei Fehler, beide behoben:** (a) Temp-Dateien eines
     getoeteten Refresh blieben fuer immer liegen (`finally` laeuft nach SIGKILL
     nicht) – neu `sweepStaleTempFiles()` am Anfang jedes Refresh, nur exakte
     Client-Temp-Namen, nur fuer nicht mehr laufende PIDs, nur regulaere Dateien
     ohne Linkverfolgung (`staleTempsRemoved` im Ergebnis); (b) der Read-back
     verweigerte einen zwischen `timestamp.json` und `snapshot.json` getoeteten
     Stand mit dem Verifier-Code `METADATA_HASH` statt dem dokumentierten
     `PERSISTED_STATE_UNVERIFIED` – jetzt ein Code, Verifier-Code in
     `details.cause`.
  2. **BR64-02 – begrenztes, frisches Neu-Lesen:** `loadTrustedState()` liest nach
     `LOCAL_STATE_CHANGED` den gesamten Zustand neu (hoechstens drei Versuche,
     Pausen 10/50 ms). Jeder Versuch prueft die Verzeichnisgrenze erneut und
     oeffnet alle Dateien neu; nichts aus einem verworfenen Versuch wird
     behalten. Nur `LOCAL_STATE_CHANGED` wird wiederholt, `INSECURE_LOCAL_STATE`
     nie; nach dem dritten Versuch Fehler mit `details.attempts = 3`
     (`tests/tuf/tuf-client-read-retry.test.js`, `readAttempts` im Zustand).
  3. **Offline-Startpruefung** `verifyTrustedStateOffline(dir, { now })`: derselbe
     Lese- und Verifikationspfad, aus dem `download` autorisiert; liest und
     verifiziert, schreibt und repariert nie (fuer einen Start mit abgeschalteten
     Updates, ROADMAP M3).
  4. **Mutationsstudie 32 → 40 Mutanten, 40/40 getoetet** (unit, Differential,
     python-tuf 7.0.1, `--require-all`, lokal 5:33 min): neu u. a. In-Place-Write,
     liegengelassene Temps, Sweep ohne Lebendpruefung oder mit Linkverfolgung,
     Retry von `INSECURE_LOCAL_STATE`, Retry ohne erneute Verzeichnispruefung,
     Annahme nach dem letzten Versuch, Verifier-Code im Read-back. Die
     Kill-Matrix laeuft in der Studie nur fuer ihre drei Mutanten
     (`env: BROWSER_TUF_KILL_MATRIX`), damit das CI-Zeitbudget haelt. Der Mutant
     `client-load-skips-secure-directory` sitzt jetzt an der Grenzpruefung im
     Leseversuch. Korrigiert: die Differential-README nannte 17 statt (bisher) 28
     `client-*`-Mutanten; jetzt 36.
- TUF-Client-Spike: Rollback-Recovery-Linie #55/#56/#57 aus den Drafts #58/#59 auf
  aktuellen `main` konsolidiert und den Hold-Befund **P2-BR59-01** aus der
  Cross-Family-Runde vom 2026-10-13 geschlossen (unsignierter
  `rollback-reset.json`-Marker).
  1. **Kontogrenze erzwungen:** Metadatenverzeichnis und vertrauenswuerdige
     Dateien (`root`, `timestamp`, `snapshot`, `targets`, `rollback-reset`), die
     ein Link sind, einem anderen Konto gehoeren oder fuer Gruppe/andere
     beschreibbar sind, werden vor jedem Lesen und jeder Anfrage mit
     `INSECURE_LOCAL_STATE` abgelehnt; der Client legt Verzeichnisse mit `0700`
     an, auch unter einer gruppenbeschreibbaren umask.
  2. **Grenze fuer das eigene Konto belegt statt behauptet:** ein gefaelschter
     Marker bewirkt nachweislich nicht mehr als das Loeschen der drei
     Rollendateien (alle 18 Korpusfaelle: gleiches Ergebnis, gleiche Anfragen,
     gleicher effektiver Vertrauenszustand, Root-Floor unberuehrt). Drei gueltig
     signierte aeltere Ketten kommen bei beiden Manipulationen durch und sind als
     dokumentierte Grenze fixiert. TUF selbst schuetzt den lokalen Speicher nicht
     (Spezifikations-Issue #107); dafuer braeuchte es einen extern verankerten
     monotonen Backstop, den der Spike nicht beansprucht.
  3. **Neuer Fehler gefunden und behoben (C5):** lief ein Refresh unter einem
     bereits offenen Reset und hatte das Repository inzwischen einen neueren Root
     veroeffentlicht, ueberschrieb der Marker die Root-Version; ein Absturz vor
     dem neuen `root.json` liess den Reset verfallen, der vorgespulte
     Snapshot-Floor kehrte zurueck und jeder weitere Refresh scheiterte mit
     `SNAPSHOT_ROLLBACK` (vor dem Fix gemessen). Der Marker behaelt jetzt den
     Root, seit dem der Reset offen ist.
  4. **Selbstpruefung derselben Runde (2026-11-03):** die Kontogrenze pruefte nur
     das Blattverzeichnis; wer einen Elternordner beschreiben konnte, haette das
     Metadatenverzeichnis wegbenennen und ersetzen koennen. Jetzt gilt die Regel
     "sicheres Verzeichnis" nach SEI CERT FIO15-C fuer alle Vorfahren bis `/`
     (Besitzer Konto oder Superuser, Gruppen-/Weltschreibrecht nur mit
     Sticky-Bit), danach laeuft jedes IO ueber den geprueften kanonischen Pfad;
     Besitzerpruefung ueber die effektive uid. Neuer Absturztest C6
     (Snapshot-only-Rotation, jeder Absturzpunkt inkl. Loeschen des Markers),
     den die Cross-Family-Runde verlangt hatte. Zwei falsche Spec-Zitate gegen
     den Spezifikations-Quelltext korrigiert (§5.4.3.1 statt §5.4.3.2;
     Freeze-Pruefung Targets §5.6.5 statt §5.6.6).
  **Evidenz:** `npm test` 452 Tests, 447 pass, 0 fail, 5 skip (als root
  gemessen; unprivilegiert wird der Ende-zu-Ende-Test fuer fremden Besitz
  sichtbar uebersprungen); TUF-Teil 106/106, auch unter `umask 002`. Die 17
  Client-Mutanten stehen jetzt in `mutation-study.mjs` (verankerte Edits auf
  einer Kopie, in CI mit `--require-all`, Report `mutations.json` mit den
  Namen der fehlschlagenden Tests); lokaler Lauf: Basis 106/0, 17/17 getoetet.
  **Offen:** externer monotoner Backstop,
  Windows-ACL-Pruefung, realer Prozess-Kill/Stromausfall, unabhaengige Runde
  auf dem neuen Kopf.

- Supply-Chain / `audit:ci`-Gate wieder gruen, diesmal durch **Entfernen** statt
  Flicken der verwundbaren Dev-Tool-Ketten (Befund: `npm audit` auf `main` meldete
  19 Advisories, davon 11 high; `security-ci` waere auf jedem neuen Lauf rot und
  blockierte u. a. PR #58). Zwei Ursachen, beide im reinen Doku-Tooling:
  1. `markdownlint-cli2` -> globby -> fast-glob -> micromatch -> `braces` <= 3.0.3
     (GHSA-vfj7-8cjw-p6xm, Stack-Exhaustion-DoS). **Es gibt keine gepatchte
     `braces`-Version**; auch `markdownlint-cli2` 0.23.3 haengt weiter daran.
     Ersetzt durch die Regel-Bibliothek `markdownlint` 0.41.1 selbst plus
     eigenen Runner `scripts/markdownlint.js` (Dateisuche per Verzeichnis-Walk,
     dieselben Regeln, dieselbe Konfiguration, jetzt `.markdownlint.jsonc`).
     Ein einmaliger Vergleich gegen globby mit den alten Optionen am
     2026-10-07 ist nicht reproduzierbar (globby ist entfernt) und wird darum
     nicht als Zahl gefuehrt. Dauerhaft gebunden in
     `tests/governance/markdownlint-runner.test.js`: jede von git getrackte
     `*.md` wird gelintet (gegen `git ls-files`), Dotfiles und `node_modules`/
     `.git` in jeder Tiefe, Inline-Disable, abgeschaltete Regeln, und ein
     Regelverstoss beendet die CLI mit Exit 1. **Symbolische Links** werden
     nicht verfolgt und nicht still uebergangen, sondern brechen die Suche mit
     `SYMLINK_IN_MARKDOWN_DISCOVERY` (CLI-Exit 2) ab (Owner-Entscheid
     2026-10-10); `node_modules`/`.git` bleiben unabhaengig vom Typ
     ausgeschlossen. Das alte globby folgte Links -- das ist eine bewusste
     Abweichung, keine Paritaet.
  2. `markdown-link-check` -> proxy-agent -> pac-proxy-agent -> get-uri ->
     `basic-ftp` (GHSA-c475-qrg2-pj4r, high) sowie `ip-address`/`socks`.
     Ersetzt durch [lychee](https://github.com/lycheeverse/lychee) 0.24.2 als
     version- und SHA-256-gepinntes Release-Binary (keine npm-Abhaengigkeit).
     Der Pflicht-Check `link-check` laeuft jetzt `--offline` (nur interne Links
     und Fragmente, Ergebnis haengt nur vom Commit ab); externe Links prueft der
     neue, woechentliche und **advisory** Workflow `docs-external-links`.
     Negativkontrolle: fehlende Datei und unbekanntes Fragment werden erkannt
     -- als eigener Schritt im `link-check`-Job mit demselben Binary, derselben
     `lychee.toml` und `--offline` (`scripts/check-lychee-fragments.mjs`,
     Fixtures `tests/fixtures/lychee-fragments/`); eine Positivkontrolle
     (gueltiges Fragment) laeuft mit, ein Exit ohne Nennung des kaputten Links
     zaehlt nicht als Erkennung.
     Der SHA-256-Pin belegt nur, WELCHES Archiv lief, nicht was es enthaelt:
     `security-ci` inventarisiert das Binary darum zusaetzlich
     (`scripts/external-tool-evidence.mjs`, Manifest
     `scripts/external-tools.json`): Workflow-Pins gegen das Manifest,
     `Cargo.lock` am gepinnten Quell-Commit per SHA-256 geprueft, SPDX-2.3-
     Inventar und OSV-Abfrage je Crate, beide als Artefakt. Grenzen: die
     `Cargo.lock` ist eine Obermenge des gelinkten Binarys (alle Features,
     Targets, Dev-Abhaengigkeiten), und keine Build-Provenienz bindet das
     Binary an sie. Stand der OSV-Abfrage am 2026-10-12 (lokal): 553 Pakete,
     17 davon mit Advisories, darunter GitHub-Schwere HIGH (u. a. `aws-lc-sys`,
     `rustls-webpki`, `quinn-proto`, `hickory-*`). Die Policy steht vorerst
     auf `report` (aufzeichnen, nicht blockieren), bis der Owner zwischen
     `block` mit begruendeten Ausnahmen und reinem Bericht entscheidet.
     OSV-Identitaet: nur crates.io-Registry-Eintraege werden per Name/Version
     abgefragt, Git-Quellen per gesperrtem Commit; Workspace-/Pfad-Mitglieder
     (11 der 553) und fremde Registries stehen als `unqueried` im Bericht
     (unter `block` sperren die fremden). Paginierte Batch-Antworten laufen
     ueber `/v1/querybatch` weiter. Ein Policy-Block endet mit Exit 3 und
     geschriebenen Belegen; `security-ci` laedt sie hoch und setzt die Policy
     erst danach durch.
  Der Weg folgt der Vorgabe aus dem Cross-Family-Review R2 (2026-10-03):
  lychee statt markdown-link-check, kein `basic-ftp`-Major-Sprung per Override.
  Ergebnis: Dev-Abhaengigkeiten 154 -> 49 Pakete (Eintraege in
  `package-lock.json` `packages` ohne den Wurzel-Eintrag `""`, dieselbe Zaehlung
  wie `npm run lockfile:check`; Eltern-Commit 8bcf6ac gegen diesen Stand),
  alle `overrides` entfallen,
  `npm audit` 0 high/critical (3 low: `katex` ueber `micromark-extension-math`,
  nur fuer Mathe-Syntax in eigener Doku, ohne Fix ausser Downgrade). Die
  Check-Namen `markdown-lint (markdownlint-cli2)` und
  `link-check (markdown-link-check)` bleiben **absichtlich** unveraendert, weil
  `protect-main` sie per Name verlangt; eine Umbenennung ist ein Ruleset-Schritt
  des Owners. `zizmor` 1.26.1 (regular und auditor): 0 Befunde; beide
  Doku-Workflows haben jetzt `concurrency`-Grenzen.

- Subresource-Integrity-Zwang (`docs/security/csp-baseline.json` -> 0.4.0):
  `Integrity-Policy: blocked-destinations=(script style)` ergaenzt.
  `script-src 'self'` beantwortet, WELCHE Herkunft ein Skript liefern darf --
  nicht, OB das gelieferte Skript das ausgelieferte ist. `'self'` laesst jedes
  same-origin-Skript ohne Integritaetspruefung zu; wer eine Datei in unserer
  eigenen Herkunft ersetzen kann (schreibbarer Storage-Bucket, CDN-Pfad,
  vergiftetes Build-Artefakt), fuehrt Code aus, den alle uebrigen Kontrollen
  fuer legitim halten -- CSP ist erfuellt, Trusted Types ebenso (das fremde
  Skript fasst schlicht keinen DOM-Sink an), und `connect-src` begrenzt nur,
  WOHIN gesendet werden darf, nicht OB fremder Code laeuft. `style` ist
  mitgesperrt: ein ausgetauschtes Stylesheet ist kein Schoenheitsfehler,
  sondern ein UI-Redressing- und Exfiltrations-Primitiv. `sources` bewusst
  weggelassen (Weglassen ist als `sources=(inline)` definiert), `endpoints`
  ebenfalls -- und `Integrity-Policy-Report-Only` steht jetzt auf der
  Verbotsliste der Endantwort: die Report-Only-Fassung erzwingt nichts, erzeugt
  aber Telemetrie und liest sich im Audit als "Integritaet ist geregelt".
  Entscheid, Alternativen und Ablehnungsgruende: ADR-010.
  **Einschraenkung:** der Header ist NICHT Baseline; Browser ohne
  Unterstuetzung ignorieren ihn -- Tiefenverteidigung ueber `script-src 'self'`,
  kein Ersatz. Die ADR-004-Browsermatrix muss festhalten, wo er wirklich greift.

- CSP (`docs/security/csp-baseline.json` → 0.3.0): `trusted-types 'none'` als
  Gegenstueck zu `require-trusted-types-for 'script'` ergaenzt. Ohne sie bleibt
  die Policy-Erstellung offen — ein kompromittiertes Skript koennte per
  `trustedTypes.createPolicy()` eine eigene Pass-through-Policy anlegen und rohe
  Strings zurueck in DOM-XSS-Sinks leiten. `'none'` verbietet jede Policy-
  Erstellung (striktester Zustand, korrekter fail-closed-Default ohne Runtime-
  Code); ADR-004 lockert bei Bedarf auf eine benannte Allowlist. Exact-Contract
  in `csp.js`/`header-values.js` plus Drift- und Positiv-Test; Beleg MDN/Chrome/
  W3C. Rationale in `docs/security/CSP_AND_SECURITY_HEADERS.md`.
- Origin-Allowlist (`src/security/header-values.js`): eingebettete IPv4-Adressen
  werden jetzt auch aus Teredo- (`2001:0000::/32`, XOR-verschleierte
  Client-IPv4) und ISATAP-Literalen (`..:5efe:a.b.c.d`) dekodiert und gegen den
  Non-Public-Filter geprueft; `192.88.99.0/24` (6to4-Relay-Anycast, RFC 7526)
  ergaenzt den reservierten IPv4-Bereich. Schliesst die zuvor als "residual"
  dokumentierte Luecke, ueber die eine private/link-local IPv4 als
  Uebergangs-IPv6-Origin an der Allowlist vorbeigeschmuggelt werden konnte.
  Regressionstests in `tests/security/production-boundary.test.js`.
- Origin-Allowlist, registry-genaue Fassung (`src/security/header-values.js`):
  Reservierte IPv6-Praefixe werden jetzt als Praefix abgelehnt, wenn ihre Zeile
  in der IANA-Registry `Globally Reachable: False` traegt — `::ffff:0:0/96`
  (RFC 4291), `100::/64` (RFC 6666), `100:0:0:1::/64` (RFC 9780),
  `64:ff9b:1::/48` (RFC 8215) und `2001::/23` (RFC 2928) abzueglich seiner
  einzeln als erreichbar registrierten Unterbloecke, dazu `3fff::/20`
  (RFC 9637) und `5f00::/16` (RFC 9602). `64:ff9b:1::/48` schliesst damit den
  Rest, den reines Dekodieren nicht abdecken kann: RFC 8215 legt die IPv4 an
  einen netzspezifischen Offset.
  **Bewusst NICHT abgelehnt** (Registry sagt `Globally Reachable: True`):
  `64:ff9b::/96`, `2001::/32` (Teredo), `2001:1::1-3/128`, `2001:3::/32`,
  `2001:4:112::/48`, `2001:20::/28` (ORCHIDv2), `2001:30::/28`. Wo ein solches
  Praefix eine IPv4 einbettet, greift stattdessen die Dekodierung — die engere
  und korrekte Kontrolle.
  Achtung bei kuenftigen Aenderungen: die Registry-CSV fuehrt `Forwardable` und
  `Globally Reachable` als getrennte Spalten, die sich fuer `100::/64`,
  `2001:2::/48`, `5f00::/16` und `64:ff9b:1::/48` unterscheiden. Massgeblich ist
  `Globally Reachable` (Spaltenindex 8).
  *Verhaltensaenderung fuer Deployer:* Approved-Origins, die auf eines dieser
  Praefixe zeigen, werden ab jetzt abgelehnt. Legitime Endpunkte sind davon
  nicht betroffen; die Ablehnung ist in beide Richtungen testgedeckt
  (Ablehn- und Annahme-Faelle je an der Praefixgrenze).
- Lokale Gates unter Windows lauffaehig (`scripts/npm-invocation.js`, neu):
  `toolchain:check` und `audit:ci` starteten npm als blosses `npm`. Unter
  Windows heisst der Einstiegspunkt `npm.cmd`, und seit der Haertung zu
  CVE-2024-27980 verweigert Node den Start von `.cmd`/`.bat` ohne `shell: true`.
  Damit liefen **zwei der fuenf lokalen Gates auf dem Entwicklungsrechner
  ueberhaupt nicht** — die Aussage `audit:ci 0/0` war nur in der CI pruefbar,
  was die LOCAL-FIRST-Annahme aushebelt. Der neue Helfer startet npms eigenen
  JS-Einstiegspunkt mit dem laufenden Node-Binary, statt eine Shell zu oeffnen;
  `verify-local.js` nutzt ihn ebenfalls und verliert seinen `shell: true`-Zweig.
- Supply-Chain / `audit:ci`-Gate: vier Advisories im Markdown-Dev-Tooling
  geschlossen (0 high/critical). `markdownlint-cli2` auf `0.23.2` angehoben
  (gepatchtes `js-yaml` 5.2.2 gegen die YAML-DoS-CVEs) und `overrides` fuer
  `ip-address@10.4.0` (u. a. GHSA-22jq-vg5j-6vgg — IPv4-mapped/NAT64-SSRF-
  Fehlklassifikation), `undici@7.29.0` und `xmlbuilder2 > js-yaml@4.3.1`
  ergaenzt. `package-lock.json` deterministisch regeneriert und registry-agnostisch
  gehalten (nur `integrity`, keine `resolved`-URLs); `npm ci`, `lockfile:check`
  und `docs:lint` weiterhin gruen.

<!-- Leere Sektionen weglassen. Verfuegbar: Added, Changed, Deprecated, Removed, Fixed, Security. -->
