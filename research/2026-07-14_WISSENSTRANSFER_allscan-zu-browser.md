# Wissenstransfer: AllScan-Runde → Browser (APP-01)

- **Datum:** 2026-07-14 · **Quelle:** AllScan-Session (Repo `coworkerchat-scanner`) · **Ziel:** dieses Repo `browser` (APP-01)
- **Scope:** NUR was aus der AllScan-Runde konkret für den **Browser** verwertbar ist. Kein anderes Projekt.
- **Zweck:** Primer für die manuelle Claude-Code-Runde — „was hatten wir davon" + „wie umsetzen in Realität".
- **Provenienz:** AllScan-Belege sind UNSERE-ARBEIT (tool-verifiziert diese Session). Externe Anker (WASM/Jco/CF) sind als solche markiert.

---

## 1. Was die AllScan-Runde dem Browser bringt (verwertbares Wissen)

### 1.1 Token-freier, datenschutz-respektierender Deploy-Pfad — BEWIESEN
- `npx wrangler pages deploy <dir> --project-name <app> --branch main` über **wrangler-Browser-OAuth** — **kein Repo-Token, kein Git-connect** (CF „Git Provider: No"). Live-Verify per **Doppel-Hash** (`curl` gegen `<app>.pages.dev`, Marker-String im Bundle prüfen).
- Diese Session live gefahren: AllScan → `allscan.pages.dev`, HTTP 200, Marker im Live-Bundle bestätigt.
- **Für den Browser:** identischer Weg als **Zwischenschritt-Auslieferung** (bis browser-nigin/WASM greift). Kanon: `[[arbeitsschablone_release-deploy-kanon]]`. Reuse auch das `release.mjs`-Muster (Build + SHA-Manifest + Freeze).

### 1.2 PWA-/Datenschutz-Härtung (revDSG-Baseline) — direkt auf „Datenschutz-top" anwendbar
- **Strenge CSP** `script-src 'self'` für PWA-Build; nur ein evtl. Standalone-Build relaxt `'unsafe-inline'` isoliert.
- **KEINE Runtime-3rd-Party-Calls / kein CDN** — alle Assets lokal (via `document.baseURI`), lazy-load aus eigenem Bundle.
- **Service-Worker-Kohärenz:** `index.html` NICHT als Offline-Shell persistieren (torn-shell/stale-shell-Falle); Build als kompatible Kohorte versionieren.
- Bezug: offener PR **#17** (`harden static security and production-evidence foundation`) ist genau der Ort für diese Baseline.

### 1.3 Anti-Overclaim / Claim-Evidence-Bindung — Pflicht für opensource-Privacy-Browser
- AllScan: Status „E2EE-bereit" war Overclaim (Daten-at-rest = Klartext) → ehrlich „Backup verschlüsselbar".
- **Für den Browser:** JEDE Datenschutz-Aussage („offline", „lokal", „kein Tracking", „verschlüsselt") muss auf Artefakt+Messung+reproduzierbaren Prüfweg zeigen (deckt sich mit Familien-NR `NR-LIB02-002`). Sonst rechtliches + Vertrauens-Risiko, gerade weil public/opensource geplant.

### 1.4 Offline-first Storage-Robustheit
- IndexedDB **failure-tolerant** (Private-Mode/Quota → „keine Persistenz", nie Crash) UND Persistenz-Ausfall **sichtbar melden** (nicht still verschlucken).
- **Für den Browser** (MCP-Client mit lokaler Wissensbasis): dasselbe Muster für lokalen Zustand/KB-Cache.

### 1.5 Selbst-Verifikations-Methodik
- Echte CI/e2e fahren + `curl`-Doppel-Hash am Live-Deploy — **nicht** Agenten-„grün" vertrauen (Lehre E2/NR-1). Für den Browser als Release-Gate übernehmen.

---

## 2. Wie umsetzen in Realität (erste konkrete Schritte für die manuelle Runde)

1. **Delivery-Ziel fixieren:** CF-Pages-Projekt `browser` (token-frei, Kanon 1.1) als **Interim**; browser-nigin (Tauri/WASM-Components + **Jco** [extern] + signierte Artefakte) als **Nordstern** „läuft im eigenen Browser".
2. **Minimal deploybare Scheibe** bauen: statische Shell + MCP-Client-Stub (konsumiert ENG-01-Contract aus `nigin-engine`) → via Kanon deployen → Doppel-Hash-Verify live.
3. **Privacy-Baseline verdrahten** (aus §1.2): CSP, no-3rd-party, offline-first-Storage failure-tolerant. → in PR #17 einhängen.
4. **Honest-Claims-Register** (aus §1.3): pro Datenschutz-Feature Evidenz-Zeile in `compliance/`.
5. **Release-Gate** (aus §1.5): echte CI + Live-Verify, bevor „grün" behauptet wird.

---

## 3. Bewusst NICHT übernommen (Anti-Over-Eng)
- AllScan-Kamera-Spezifika (Selbstauslöser, Edge-Detection, Auto-Crop) — irrelevant für den Browser.
- Storage-at-rest-Verschlüsselung — bei AllScan bewusst nicht gebaut; für den Browser erst bei echtem Secret-at-rest-Bedarf.

*Verweise: `docs/CHARTER.md` · `docs/ROADMAP.md` · `docs/OPEN_DECISIONS.md` · `[[arbeitsschablone_release-deploy-kanon]]` · `[[project_allscan_und_deploy_2026_07_13]]` · Familien-NR `NR-LIB02-002`.*
