# 007-Analyse — ENGINE-/PLATTFORM-Track (PROVENIENZ, advisory-only)

> **RESOLVED (Marco 2026-07-10):** Inhaltlicher Owner dieser Analyse ist **nigin-engine
> (ENG-01)** — dort als `docs/PLATFORM_ROADMAP_M0.md` gelandet. Diese Datei bleibt in
> `browser` nur als **historischer Provenienz-Anker** (Namenskollision-Herkunft). Keine
> Pflege hier; Aktualisierungen erfolgen in nigin-engine.
>
> **ACHTUNG — Zuordnung:** Diese Analyse (cwzl 2026-07-10-001) betrifft den
> **ENGINE-/PLATTFORM-Track** (Wasmtime-Host / WIT / offline-core), der laut
> Verosystem-Landkarte v0.2 zu **nigin-engine (ENG-01)** gehoert, **NICHT** zu
> **APP-01 `browser`** (natives, offline-faehiges Browser-/Webapp-Runtime-Programm;
> reframed 2026-07-14, ADR-005/006/007).
>
> Sie ist hier **ausschliesslich als Provenienz** abgelegt, weil das cwzl-Doc unter
> dem Namen "browser-repo" gefuehrt wurde (Namenskollision, Landkarte R4). Der Inhalt
> ist **KEINE APP-01-Roadmap**. Zuordnung RESOLVED (Marco 2026-07-10 → nigin-engine),
> siehe `docs/OPEN_DECISIONS.md` (D1).
>
> Provenienz: cwzl 2026-07-10-001 · browser-repo-analyse-roadmap · Claude · advisory-only.
> Zielrepo im Original-Doc: `nigin-offline-core` (Wasmtime-Host, WIT-Contracts, CAS,
> Engine-Fabric, WASI-0.2/0.3).

## Zielbild (Engine-Track)

Offline-first **Workbench** mit **evidenzgebundenem Engine-Vertrag** — bewusst
**kein Universalbrowser**. Der Engine-Vertrag ist an nachpruefbare Evidenz gebunden;
Ausfuehrung deterministisch und replay-faehig.

## Identifizierte Luecken (Engine-Track)

| ID | Befund | Prioritaet |
|----|--------|-----------|
| L1 | Hostcall-Blocking umgeht Fuel/Epoch (Guest kann in Hostcall blockieren, Fuel-/Epoch-Limits greifen dort nicht) | P0 |
| L2 | Wasmtime-Defaults ohne Limits (StoreLimits/Memory/Table nicht gesetzt) — CI-Config-Assertion noetig | P0 |
| L3 | WASI-Strategie: 0.2-Guest, 0.3-ready-WIT, Wasmtime>=43-Pin per ADR (WASI 0.3.0 released 2026-06-11) | P1 |
| L4 | CRA-Meldepflicht ab 2026-09-11 — SECURITY.md vorziehen | P1 |
| L5 | Doppelprofil: Fuel (deterministisch / Replay) vs. Epoch (Wanduhr-Deadline) — beide Profile explizit | P1 |
| L6 | Repo-Hygiene | P2 |
| L7 | README-Trennung `core` / `chat` | P2 |

## Milestones (Engine-Track)

- **M0 — Truth-Base.** Fundament + Repo-Hygiene.
- **M1 — Contract & Evidence.** WIT-Parser-CI-Gate, CAS-Spec, Capability-SemVer.
- **M2 — Wasmtime-Vertical-Slice.** Limits-Tripel (fuel + epoch + StoreLimits),
  Hostcall-Cancellation, G2-Tests T1–T7.
- **M3 — First-Party-Engine-Fabric.** Truth-Core- / Q-Forge- / LiouScope-Adapter.
- **M4 — Shell-Entscheid.**

## Wichtige Fakten / Anker

- WASI 0.3.0 **released 2026-06-11** (relevant fuer L3 WIT-0.3-readiness).
- CRA-Meldepflicht **ab 2026-09-11** (relevant fuer L4 SECURITY.md-Vorziehen).
- L1/L2 sind **P0** (Sandbox-Sicherheit / Ressourcen-Limits).

## Konsequenz fuer dieses Repo (APP-01)

Diese Inhalte werden **nicht** in die APP-01-Roadmap (`docs/ROADMAP.md`) uebernommen.
Empfohlene Landung: **nigin-engine (ENG-01)** — Marco-Entscheid offen
(`docs/OPEN_DECISIONS.md`).
