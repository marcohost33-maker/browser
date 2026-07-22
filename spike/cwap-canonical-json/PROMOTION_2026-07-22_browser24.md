# Promotion 2026-07-22 — CWAP-Strict-JSON v0.1.2 (browser#24, Track-B-Teil)

- Status: **PROMOTED** (owner-authorisiert: Marco „browser#24 promoten", 2026-07-22).
- Von: Vero (Claude Opus 4.8), Owner-Seite.
- Umfang der Promotion: die **kanonische Manifest-Repräsentation von ADR-007 Track B**
  (CWAP-Strict-JSON v0.1.2 + Fehlerpräzedenz P1–P4 + F6-Präzisierungen a–e).
- **NICHT** promotet / bleibt OFFEN in #24: Track A (`.swbn`/IWA-Package), Track C
  (TUF-Secure-Update), Publisher-Admission, Capability-Approval, Code-Safety. Issue #24
  bleibt daher **OPEN** — dies ist Teil-Fortschritt, kein Abschluss des P0.

## Was promotet wird

Der bisher fail-closed gehaltene CWAP-Teil ist jetzt entsperrt, weil sein einziges
offenes Gate (F6-Design-Votum) owner-seitig adjudiziert ist (`ADJUDICATION_F6_2026-07-22.md`;
Unabhängigkeit via Fremd-Oracle Trail-of-Bits-rfc8785 + ChatGPT-Votum + referenzfreie C-Impl).

- SPEC-Status DRAFT → **ACCEPTED** (`SPEC_v0.1.2_DRAFT.md` Kopf).
- Integrations-Branch `vero/cwap-v012-r1-integration` → in `main` gelandet (fast-forward).

## Landungs-Umfang (ehrlich: der Branch bündelt mehr als CWAP)

Der Branch trägt 26 Commits seit dem alten `main`-Stand — nicht nur CWAP, sondern die
akkumulierte browser-Reframe-Arbeit, die nie gelandet war:

- CWAP-Strict-JSON v0.1.2-r1 Core + 4 Impls (Py/Rust/JS + differential) + F6-Adjudikation.
- ADR-007 Amendments (§G Aegis-Primärquellen-Pass, §H Container-Format-Re-Eval).
- ADR-008 (browser standalone; MCP internal/optional) + Reframe-Doc-Sweep.
- Security-Fixes (serializeCsp Direktiven-Validierung, CSP/Origin-Härtung, Aegis-Findings).
- `verify:local` CI-Parity-Gate + opt-in pre-push-Hook.

## Grün-Nachweis vor der Landung (WO-Gate, 2026-07-22, tool-belegt)

- `verify:local` → **RESULT: OK — all required gates passed** (lockfile PASS, csp PASS,
  185 Serializer/Header-Tests PASS, markdownlint PASS; toolchain WARN = Node-Version OK,
  audit SKIP = braucht Netz).
- CWAP: Konformität **31/31**, Fremd-Oracle ToB-rfc8785 == CWAP == JCS (744 Accept + 4/4),
  Py↔JS-Differential GRUEN.
- 4 latente markdownlint-Verstösse (nie von CI gefangen, da Actions billing-locked =
  startup_failure) vor der Landung gefixt (auto-fix, 4 Zeilen).

## Reversibilität / CI

- Landung = fast-forward von `main` (kein 3-way-Merge, keine Konflikte).
- GitHub-Actions sind billing-locked → jeder push = `startup_failure` in 0s = **freeze-neutral**
  (keine CI-Minuten). Der reale Gate ist der lokale `verify:local`-Grün-Lauf oben.

## Nächste #24-Schritte (nicht hier)

Track A `.swbn`/IWA-Bewertung · Track C TUF-Secure-Update · Publisher-Admission (#25) ·
Capability-Approval · Code-Safety-Review. Diese bleiben P0-offen in Issue #24.

---
*Owner-authorisierte Promotion des Track-B-Manifest-Teils. Kein Abschluss von #24.
Alle „grün"-Aussagen tool-belegt (verify:local-Exit + CWAP-Skript-Exits gesehen).*
