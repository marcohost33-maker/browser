# ROADMAP — APP-01 `browser` (öffentliche Webapp)

> Scope: **nur** `marcohost33-maker/browser` = APP-01 öffentliche Webapp + MCP-Client.
> Nicht verwechseln mit `browser-nigin`. Engine-/Plattformteile bleiben außerhalb dieses Repos.

## M0 — Charter und Scope · RESOLVED

- [x] Charter und Non-Goals festgelegt.
- [x] APP-01 von Engine-/Plattform-Scope getrennt.
- [x] Privacy-first öffentliche MCP-Client-Webapp als Arbeitsziel dokumentiert.

## M1A — Entscheidungs- und Sicherheitsfundament

- [x] ADR-001: Architekturgrenzen und minimaler Read-only-Slice.
- [x] ADR-002: Contract-Artefakt-Signatur und Provenienz.
- [x] Threat Model, Privacy Model und MCP Consumer Profile.
- [x] Master Roadmap, Open-Topics- und Quellen-/Standards-Baseline.
- [x] Maschinenlesbare CSP-/Security-Header-Baseline.
- [x] Ausführbarer CSP-Serializer mit Fail-closed-Validierung.
- [x] Exakte `connect-src`-Allowlist und Schutz gegen CSP-Override/Header-Injection.
- [x] Security-CI und HTTP-Integrationstest; PR #15 meldete 35 bestandene Tests.
- [x] Header-Wert-Härtung: Referrer-Policy-Allowlist, Permissions-Policy-Feature-Disablement und HSTS `includeSubDomains` mit Regressionstests (#16, auf diesem Branch).
- [ ] ADR-003: Produkt-/Endpoint-/Trust-/Deployment-Modell aus #13 und #14.
- [ ] Gepinnter MCP-Contract, Fixtures und deterministischer Conformance-Flow.
- [ ] ADR-004: UI-/Build-/Framework-/Browsermatrix-Entscheid aus #7.

**Gate M1A:** Kein realer MCP-Runtime-Code, keine finale OAuth-Architektur und keine dynamische Endpoint-Freigabe, bis Produktziel (#14), Endpoint-/Deployment-Modell (#13) und Contract-Profil entschieden sind.

## M1B — Secure Project Bootstrap

Bereits vorhanden:

- [x] Node-22-Security-Kern ohne Runtime-Abhängigkeiten.
- [x] Security- und Dokumentations-CI mit eingeschränkten Berechtigungen.
- [x] Statische Security-Header-Erzeugung und reale HTTP-Response-Prüfung.

Noch erforderlich:

- [ ] TypeScript strict für die eigentliche Webapp.
- [ ] Gepinnte Toolchain und Lockfile nach ADR-004.
- [ ] Lint, Format, Unit-, Integrations- und Browser-E2E-Harness.
- [ ] Dependency Review, Secret Scan, SAST, SBOM und Build-Provenienz.
- [ ] Branch Protection, CODEOWNERS und nachvollziehbare Release-Evidence.
- [ ] Keine Drittanbieter-Telemetrie, Remote-Fonts oder unnötigen CDN-Abhängigkeiten.

## M1C — Privacy-first Vertical Slice

Blockiert durch #13, #14 und Contract-Gate:

- [ ] Erlaubten Endpoint konfigurieren und Trust-Tier sichtbar machen.
- [ ] Verbindung initialisieren; Endpoint-, Origin- und Protokollidentität anzeigen.
- [ ] Capabilities als untrusted darstellen und deny-by-default behandeln.
- [ ] Explizite Zustimmung für genau einen begrenzten Read-only-Request.
- [ ] Timeout, Abort, Größen-, Element- und Verschachtelungslimits.
- [ ] Ergebnis ausschließlich validiert und sicher als Daten rendern.
- [ ] Normalisierte Fehler für Transport, Protokoll, Auth, Timeout, Cancel und Schema.
- [ ] Clear-session entfernt sensible Daten aus Speicher, URL, Cache, DOM und Logs.
- [ ] Dynamische Endpoint-Policy und tatsächlich ausgelieferte CSP bleiben synchron; niemals CSP-Wildcards als Ausweichlösung.

## M1D — Verifikation und Release Gate

- [ ] Contract- und Negativtests: malformed JSON-RPC, Capability Drift, Replay, Injection, Oversize und Redirects.
- [ ] Exfiltrations- und Prompt-Injection-E2E aus #11, sobald Runtime existiert.
- [ ] Sensitive-Data-Sink-Test für Web Storage, IndexedDB, Cache Storage, URL/History, DOM, Konsole und Diagnostikexport.
- [ ] WCAG-2.2-AA-orientierte automatisierte und manuelle Prüfung des kritischen Flows.
- [ ] Threat Model, Privacy Model und Datenflussdiagramm gegen Implementierung aktualisieren.
- [ ] LICENSE, SECURITY.md, Privacy Notice, Accessibility Statement, SBOM und Provenienz.
- [ ] Staging, Rollback, Cache-Invalidierung und Incident-Tabletop.

**Gate M1:** Alle erforderlichen Evidenzen verlinkt; keine P0-Risiken oder unowned P1-Risiken; Consent nicht umgehbar; Contract gepinnt; Browser-, Privacy-, Accessibility-, Security- und Rollback-Tests bestanden.

## M2 — Nur nach eigenem ADR

OAuth-Erweiterungen, PWA/Service Worker, persistierte Endpoints, Write-Tools, Sampling, Elicitation, lokale MCP-Server, autonome Abläufe und beliebige Remote-Endpoints sind jeweils eigenständige Produkt-, Architektur- und Threat-Model-Entscheidungen.

## Ausdrücklich nicht APP-01

Wasmtime-Host, WIT-Ownership, CAS, Engine-Fabric, WASI-Guest/Host, Solver und Orchestrator gehören nicht in dieses Browser-Repo.