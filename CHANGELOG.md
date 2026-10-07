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
- Gekoppelte Update-Transaktion als Spike (`spike/update-activation/`, ADR-009
  "atomic metadata/package activation"): ein Offline-Update-Buendel wird als **ein**
  Commit des Activation-Stores angewandt. Derselbe atomare Rename von `state/CURRENT`
  benennt die neue Paketversion (ein opakes, content-adressiertes Objekt, kein
  Containerformat gewaehlt) und bindet die exakten Bytes von root, timestamp, snapshot
  und targets sowie einen App-Trust-State (Identitaet, Version, Digest, genehmigte
  Capabilities, Entscheid). Compare-and-swap auf die verifizierte Generation; Laden
  verifiziert die gebundene Kette bei jedem Start neu (Signaturen, Schwellen,
  Versions-/Laengen-/Hash-Pins), aber **nie die Frische**, damit eine installierte App
  offline weiterlaeuft; ein nicht verifizierender Zustand schlaegt fail-closed fehl
  statt zurueckgesetzt zu werden. Die beiden Reparaturpfade des rollenweisen Clients
  (Rotation-Reset nach TUF 5.3.11 beim Laden, Resume ab vertrautem Timestamp) entfallen
  konstruktiv. Lokaler Rollback bewegt nur das Paket; Metadaten und Rollback-Floors
  bleiben gebunden. Activation-Store um die Leseseite der Bindings ergaenzt
  (`readCommitBindings()`, `readVersionBindings()`); Commit-Protokoll unveraendert, sein
  Crash-Matrix-Report aendert sich nur im Quell-Digest.
  **Evidenz:** Modell-Crash-Matrix ueber sechs Szenarien inkl. Root-Rotation der
  Online-Schluessel: 64'931/64'931 Faelle konsistent, 0 Durability-Verletzungen;
  329/329 reale Prozess-Crashes (ext4); Negativkontrolle (dieselbe Verifikation, aber
  Metadaten und Paket in zwei Commits) in jeder Variante als `state-not-old-or-new`
  erkannt (u. a. 53/100 Prozess-Crash-Punkte); 11/11 Kontroll-Mutationen getoetet;
  16 Unit-Tests. Windows/macOS ueber `activation-store-ci`.
  **Offen:** Anbindung des zustandsbehafteten CLI, realer Stromausfall-Drill,
  Delegationen, unabhaengiges Review; der Start-Check kann einen lokalen Rollback nicht
  von "Metadaten vor Paket" unterscheiden (vom gekoppelten Protokoll nie erzeugt,
  per Test dokumentiert).
- TUF-Spezifikations-Delta v1.0.35 -> v1.0.36 geprueft
  (`docs/research/2026-10-07_TUF_SPEC_1.0.35_TO_1.0.36_DELTA.md`): 11 Hunks, alle
  redaktionell (THRESHOLD-Definition verschoben, KEYID-Verweise auf root gescoped,
  Kopfdaten, Linkformat), keine normative Aenderung. Der Pin bleibt 1.0.35; der Bump
  ist eine eigene Profilentscheidung (#49), nie Teil eines Sicherheitsfixes.

### Security

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
     **Paritaet belegt:** identische Dateiliste (61/61) gegen globby mit den
     alten Optionen und identische Befunde (11/11) auf einem gesaeten
     Fehlerkorpus inkl. Inline-Disable, Dotfiles und `node_modules` in jeder
     Tiefe; Positiv-/Negativkontrollen in
     `tests/governance/markdownlint-runner.test.js`.
  2. `markdown-link-check` -> proxy-agent -> pac-proxy-agent -> get-uri ->
     `basic-ftp` (GHSA-c475-qrg2-pj4r, high) sowie `ip-address`/`socks`.
     Ersetzt durch [lychee](https://github.com/lycheeverse/lychee) 0.24.2 als
     version- und SHA-256-gepinntes Release-Binary (keine npm-Abhaengigkeit).
     Der Pflicht-Check `link-check` laeuft jetzt `--offline` (nur interne Links
     und Fragmente, Ergebnis haengt nur vom Commit ab); externe Links prueft der
     neue, woechentliche und **advisory** Workflow `docs-external-links`.
     Negativkontrolle: fehlende Datei und unbekanntes Fragment werden erkannt.
  Der Weg folgt der Vorgabe aus dem Cross-Family-Review R2 (2026-10-03):
  lychee statt markdown-link-check, kein `basic-ftp`-Major-Sprung per Override.
  Ergebnis: Dev-Abhaengigkeiten 156 -> 49 Pakete, alle `overrides` entfallen,
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
