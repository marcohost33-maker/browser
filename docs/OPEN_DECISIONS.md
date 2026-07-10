# OPEN DECISIONS — APP-01 `browser`

> Offene Entscheidungen fuer Marco. Advisory-only, kein Selbst-Entscheid.

## D1 (ZENTRAL, blockierend) — Scope-/Zuordnungs-Konflikt cwzl vs. Landkarte

Der cwzl-"browser-repo"-Roadmap-Inhalt (Wasmtime / WIT / Engine-Fabric / CAS /
WASI / offline-core) gehoert **inhaltlich zu nigin-engine (ENG-01)**, **nicht zu
APP-01 `browser`**. APP-01 ist laut Landkarte v0.2 die **oeffentliche MCP-Client-Webapp**.

**Fragen an Marco:**
1. Soll die Plattform-/Engine-Roadmap (Provenienz in
   `docs/007_ANALYSE_platform-track_PROVENIENZ.md`) stattdessen in **nigin-engine
   (ENG-01)** gelandet werden?
2. Was ist der **eigentliche Inhalt / Scope von APP-01 `browser`** (oeffentliche
   MCP-Client-Webapp)? — d.h. welche konkreten Slices gehoeren in `docs/ROADMAP.md`?

Bis D1 entschieden ist, bleibt M0 in `docs/ROADMAP.md` blockiert (nur Charter +
Scope-Klaerung gelandet, keine Engine-Inhalte eingeplant).

## D2 (aus dem cwzl-Doc uebernommen) — Repo-Topologie Wasmtime-Host

Wasmtime-Host als **Pfad IN `nigin-offline-core`** (Monorepo, z.B. `platform/host/`)
**vs.** als **separates Repo**? Diese Frage stammt aus dem Original-Doc und betrifft
den Engine-Track; sie ist mit D1 zu klaeren (Landung des Engine-Inhalts).
