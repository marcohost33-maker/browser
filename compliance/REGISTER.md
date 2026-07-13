# Compliance-Register — browser (APP-01)

> Datenschutz-/Recht-Register des Browser-Repos. Global gespiegelt in
> `Vero Meta/COMPLIANCE_DATENSCHUTZ_RECHT_REGISTER.md`. Seed aus AllScan-Lehre 2026-07-14.
> Status-Werte: REQUIRED · ACTIVE_GATE · DESIGN_REQUIRED · DONE.

| ID | Thema | Risiko / Auslöser | Kontrolle / Maßnahme | Status | Prio | Anker |
|---|---|---|---|---|---|---|
| CMP-APP01-001 | Datenschutz-Claim-Ehrlichkeit (revDSG) | Public/opensource-Browser verspricht mehr Privacy als real (z.B. „verschlüsselt", „kein Tracking") | JEDE Privacy-Aussage evidenz-gebunden (Artefakt+Messung+Prüfweg); kein Overclaim | ACTIVE_GATE | P0 | AllScan „E2EE-bereit"→„Backup verschlüsselbar"; Familien-NR-LIB02-002 |
| CMP-APP01-002 | Keine Runtime-3rd-Party-Calls / kein CDN (revDSG) | Externe Requests zur Laufzeit leaken Nutzerdaten/IP | Strenge CSP `script-src 'self'`; Assets lokal (baseURI); neue Outbound-Requests = explizites Marco-OK | REQUIRED | P0 | AllScan AGENTS.md revDSG |
| CMP-APP01-003 | Deploy-Provenienz / Secrets-Hygiene | Repo-Tokens / PII in Deploy-Artefakten oder CI | Token-frei via wrangler-OAuth (kein Repo-Token, kein Git-connect); keine lokalen Pfade/PII in Artefakten | REQUIRED | P1 | AllScan-Deploy-Kanon 2026-07-14 |
| CMP-APP01-004 | Service-Worker-Kohärenz / Stale-Shell | Alte Offline-Shell + neue Chunks → inkonsistenter/veralteter Zustand | `index.html` nicht als Offline-Shell persistieren; Build als kompatible Kohorte versionieren | DESIGN_REQUIRED | P1 | AllScan PWA torn-shell-NR |

*Nächster Schritt (manuelle Runde): CMP-APP01-002/004 in PR #17 (static-security-hardening) einhängen + verifizieren.*
