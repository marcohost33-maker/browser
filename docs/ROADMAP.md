# ROADMAP — APP-01 `browser` (oeffentliche Webapp)

> Scope: **nur** APP-01 = oeffentliche Webapp + MCP-Client.
> Der Engine-/Plattform-Teil (Wasmtime-Host / WIT / Engine-Fabric) ist **bewusst
> NICHT** hier eingeplant — er gehoert zu nigin-engine (ENG-01). Provenienz:
> `docs/007_ANALYSE_platform-track_PROVENIENZ.md`.

## M0 — Charter + Scope-Klaerung  ·  **RESOLVED (Marco 2026-07-10)**

- [x] `docs/CHARTER.md` — Zweck/Non-Goals APP-01 gelandet.
- [x] Engine-Track-Analyse als Provenienz abgelegt (nicht als APP-01-Roadmap).
- [x] Scope-Klaerung D1 entschieden: Engine-Plattform-Roadmap → **nigin-engine (ENG-01)**;
      APP-01 = oeffentliche MCP-Client-Webapp (`docs/OPEN_DECISIONS.md` D1 RESOLVED).

## M1+ — Platzhalter (Inhalt beim APP-01-Bau)

> Scope steht (public MCP-Client-Webapp). Konkrete Slices werden beim APP-01-Bau gefuellt:

- **MCP-Client-Slice** — Anbindung als Client an den MCP-Contract von nigin-engine
  (ENG-01). Inhalt sobald Scope bestaetigt.
- **Datenschutz-Modell** — Berechtigungsmodell, Datensparsamkeit-Defaults.
  Inhalt sobald Scope bestaetigt.
- **API-gratis-Strategie** — Standard-Betrieb ohne kostenpflichtige APIs.
  Inhalt sobald Scope bestaetigt.

## Ausdruecklich NICHT in dieser Roadmap

Der Engine-Plattform-Teil (Wasmtime-Host, WIT-Contracts, CAS, Engine-Fabric,
WASI-Guest/Host, Fuel/Epoch-Limits, WIT-Parser-CI-Gate) ist **kein** APP-01-Thema.
Siehe `docs/007_ANALYSE_platform-track_PROVENIENZ.md` und D1 in
`docs/OPEN_DECISIONS.md`.
