# OPEN DECISIONS — APP-01 `browser`

> Offene Entscheidungen fuer Marco. Advisory-only, kein Selbst-Entscheid.

## D1 — Scope-/Zuordnungs-Konflikt cwzl vs. Landkarte — **RESOLVED (Marco, 2026-07-10)**

Der cwzl-"browser-repo"-Roadmap-Inhalt (Wasmtime / WIT / Engine-Fabric / CAS /
WASI / offline-core) gehoert **inhaltlich zu nigin-engine (ENG-01)**, **nicht zu
APP-01 `browser`**. APP-01 ist die **oeffentliche MCP-Client-Webapp**.

**Marco-Entscheid 2026-07-10:** Die Plattform-/Engine-Roadmap wird **nach
`nigin-engine` (ENG-01)** ueberfuehrt (`docs/PLATFORM_ROADMAP_M0.md` dort). **APP-01
`browser` bleibt = oeffentliche MCP-Client-Webapp** (API-gratis, Datenschutz-top,
konsumiert MCP-Contract von nigin-engine, definiert ihn nicht). Der Provenienz-Text
`docs/007_ANALYSE_platform-track_PROVENIENZ.md` bleibt hier nur als historischer Anker;
inhaltlicher Owner ist ab jetzt nigin-engine.

Folgefrage (offen, kleiner): welche konkreten APP-01-Slices (MCP-Client, Datenschutz-
Modell, API-gratis-Strategie) zuerst? — wird beim APP-01-Bau gefuellt.

## D2 — Repo-Topologie Wasmtime-Host — verschoben nach nigin-engine

Wasmtime-Host als **Pfad IN `nigin-offline-core`** (Monorepo) **vs.** separates Repo:
betrifft den Engine-Track und wird jetzt **in nigin-engine** entschieden (D1-Folge),
nicht mehr hier.
