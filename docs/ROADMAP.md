# ROADMAP — APP-01 `browser` (oeffentliche Webapp)

> Scope: **nur** APP-01 = oeffentliche Webapp + MCP-Client.
> Engine-/Plattformteile gehoeren zu nigin-engine (ENG-01).

## M0 — Charter + Scope-Klaerung · RESOLVED (2026-07-10)

- [x] Charter und Non-Goals festgelegt.
- [x] Engine-Track als Provenienz abgelegt und APP-01/ENG-01 getrennt.
- [x] APP-01 als oeffentliche, privacy-first MCP-Client-Webapp bestaetigt.

## M1A — Foundation und Freigabefaehigkeit

- [x] ADR-001: Architekturgrenzen und M1-Slice.
- [x] Threat Model mit Release-Blockern.
- [x] Privacy Model mit Speicher-, Netzwerk- und Retention-Regeln.
- [x] MCP Consumer Profile mit ENG-01-Eingangsvoraussetzungen.
- [x] ADR-002: Contract-Artefakt-Signatur/Provenienz (Sigstore/cosign + SLSA), verify-before-trust.
- [x] CSP-/Security-Header-Profil spezifiziert + maschinenlesbare Baseline (`docs/security/csp-baseline.json`); `connect-src`-Allowlist-Konzept.
- [x] Minimal-CI-Fundament: Markdown-Lint + Link-Check + zizmor (SHA-gepinnt, inline).
- [ ] ENG-01 liefert **signierte/provenanzierte** Contract-Artefakte, Fixtures und Conformance-Flow (ADR-002).
- [ ] Technologie-Spike entscheidet UI-Framework, Build, Browsermatrix und PWA-Verzicht/-Einsatz.
- [ ] Security-Header-Profil als **ausfuehrbare** Konfiguration (Serializer + Test aus `csp-baseline.json`) im Build.

**Gate M1A:** Kein Runtime-MCP-Code gegen Annahmen. Contract-Version, Fixtures und ein deterministischer Read-only-Flow muessen vorliegen.

## M1B — Secure Project Bootstrap

- [ ] TypeScript strict, reproduzierbarer Build und gepinntes Lockfile.
- [ ] Lint, Format, Unit-, Integration- und Browser-E2E-Testharness.
- [ ] Dependency Review, Secret Scan, SBOM und Build-Artefakt-Nachweis in CI.
- [ ] Restriktive CSP ohne `unsafe-eval`; `frame-ancestors 'none'`, Referrer- und Permissions-Policy.
- [ ] Keine Drittanbieter-Telemetrie, Remote-Fonts oder unnoetigen CDN-Abhaengigkeiten.

## M1C — Privacy-first Vertical Slice

- [ ] Endpoint konfigurieren; Produktion HTTPS-only, Loopback-HTTP nur explizit fuer Entwicklung.
- [ ] Verbindung initialisieren und Endpoint-/Protokollidentitaet sichtbar machen.
- [ ] Capabilities verhandeln, als untrusted anzeigen und deny-by-default behandeln.
- [ ] Explizite Zustimmung fuer genau einen read-only Request.
- [ ] Request senden, abbrechen und mit Timeout/Grössenlimit begrenzen.
- [ ] Ergebnis sicher als Daten rendern; kein ungeprueftes HTML/Script.
- [ ] Normalisierte Fehler fuer Transport, Protokoll, Auth, Timeout, Cancel und Validierung.
- [ ] Clear-session entfernt sensible Daten aus Speicher, URL, Cache und Logs.

## M1D — Evidence und Release Gate

- [ ] Contract- und Negativtests: malformed JSON-RPC, Capability-Drift, Replay, Injection, Oversize, Redirect.
- [ ] Browser-Speicher-Test prueft localStorage, sessionStorage, IndexedDB, Cache Storage, URL und Konsole.
- [ ] Accessibility-Smoke: Tastatur, Fokus, sichtbarer Fokus, keine Keyboard Trap.
- [ ] Threat Model und Privacy Model gegen Implementierung aktualisiert.
- [ ] LICENSE, SECURITY.md, Privacy Notice, SBOM und reproduzierbarer Build vorhanden.

**Gate M1:** Alle Tests gruen, keine Secrets persistent, Consent nicht umgehbar, Contract gepinnt, Security-Header nachgewiesen.

## M2 — Nach M1 bewusst entscheiden

OAuth, PWA/Service Worker, gespeicherte Endpoints, Schreiboperationen, lokale MCP-Server und autonome Abläufe sind jeweils eigene Design- und Threat-Model-Entscheide. Sie sind nicht implizit durch M1 freigegeben.

## Ausdruecklich nicht APP-01

Wasmtime-Host, WIT-Contract-Ownership, CAS, Engine-Fabric, WASI-Guest/Host, Solver und Orchestrator bleiben ENG-01-/Engine-Verantwortung.
