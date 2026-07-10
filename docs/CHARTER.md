# CHARTER — APP-01 `browser`

> Status: M0 (Charter). Provenienz: cwzl 2026-07-10-001 (advisory-only).
> ACHTUNG Scope-Klaerung offen — siehe `docs/OPEN_DECISIONS.md`.

## Zweck (gemaess Verosystem-Landkarte v0.2)

APP-01 `browser` ist die **oeffentliche Webapp + MCP-Client** des Nigin/Vero-Engine-Systems.
Sie **konsumiert** den MCP-Contract, sie **definiert ihn NICHT**. Der Source-of-Truth fuer
den MCP-Contract liegt bei **nigin-engine (ENG-01)**.

## Leitplanken (Product Principles)

- **MCP-Client, kein Contract-Owner.** APP-01 nutzt die von nigin-engine (ENG-01)
  definierte Anschlussflaeche als Client.
- **API-moeglichst-gratis.** Der Standard-Betrieb soll ohne kostenpflichtige APIs
  auskommen; kostenpflichtige Pfade bleiben optional und explizit.
- **Webappfaehig.** Lauffaehig als Web-App (PWA-Kandidat), nicht an eine Desktop-Runtime
  gebunden.
- **Datenschutz-top.** Datensparsamkeit als Default; klare, minimale Berechtigungsmodelle
  fuer jeden Datenzugriff.
- **Klare Berechtigungsmodelle.** Jede Capability/Permission ist explizit, sichtbar und
  widerrufbar.
- **Perspektivisch open-source.** Jetzt privat; spaeter bewusst public nach Marco-Freigabe.

## Non-Goals (bewusst NICHT APP-01)

- **Kein eigener MCP-Contract.** Contract-Definition ist Sache von nigin-engine (ENG-01).
- **Kein Engine-/Wasmtime-Host.** Wasmtime-Host, WIT-Contracts, CAS, Engine-Fabric,
  WASI-Guest/Host gehoeren zum Engine-/Plattform-Track (nigin-engine, ENG-01) —
  NICHT hierher. Vgl. `docs/007_ANALYSE_platform-track_PROVENIENZ.md`.
- **Kein Universalbrowser / kein Marketplace im MVP.** Fokus MVP = MCP-Client-Webapp,
  nicht ein allgemeiner Web-Browser oder App-Marktplatz.

## Abgrenzung zum Engine-Track (Namenskollision R4)

Das cwzl-"browser-repo"-Doc (2026-07-10-001) beschreibt faktisch den
**Engine-/Plattform-Track** (Zielrepo im Doc = `nigin-offline-core`: Wasmtime-Host,
WIT-Contracts, CAS, Engine-Fabric, WASI-0.2/0.3). Dieser Inhalt ist als **Provenienz**
in `docs/007_ANALYSE_platform-track_PROVENIENZ.md` abgelegt und gehoert laut Landkarte
zu **nigin-engine (ENG-01)**, nicht zu APP-01 `browser`. Die Zuordnung ist eine offene
Marco-Frage (`docs/OPEN_DECISIONS.md`).

## Referenzen

- Wissenskarte: `MATRIX_REPOS.md` (Vero-SoT), Eintrag `APP-01`.
- Kanon: `LANDKARTE_VEROSYSTEM_REPOS_v0.1.md` (v0.2).
- Verwandt: nigin-engine (ENG-01) = MCP-Contract-Owner.
