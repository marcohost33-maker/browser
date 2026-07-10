# ROADMAP — APP-01 `browser` (oeffentliche Webapp)

> Scope: **nur** APP-01 = oeffentliche Webapp + MCP-Client.
> Der Engine-/Plattform-Teil (Wasmtime-Host / WIT / Engine-Fabric) ist **bewusst
> NICHT** hier eingeplant — er gehoert zu nigin-engine (ENG-01). Provenienz:
> `docs/007_ANALYSE_platform-track_PROVENIENZ.md`.

## M0 — Charter + Scope-Klaerung  ·  **BLOCKIERT auf Marco-Entscheid**

- [x] `docs/CHARTER.md` — Zweck/Non-Goals APP-01 gelandet.
- [x] Engine-Track-Analyse als Provenienz abgelegt (nicht als APP-01-Roadmap).
- [ ] **BLOCKER:** Scope-Klaerung D1 (`docs/OPEN_DECISIONS.md`) — Marco-Entscheid,
      wo die cwzl-Engine-Roadmap landet und was der echte APP-01-Scope ist.

## M1+ — Platzhalter (Inhalt sobald Scope bestaetigt)

> Wird erst nach D1-Entscheid konkretisiert. Aktuell reine Platzhalter:

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
