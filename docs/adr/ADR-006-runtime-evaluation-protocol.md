# ADR-006 — Native Runtime Evaluation Protocol

- Status: PROPOSED
- Date: 2026-07-14
- Depends on: ADR-005
- Decision owner: Marco

## Question

Which runtime can host T1 owner-controlled offline webapps with the smallest
maintainable attack surface while preserving required compatibility on Windows,
macOS and Linux?

## Candidates

1. Tauri 2 / WRY / system WebView
2. Electron / bundled Chromium
3. Windows-only WebView2-direct reference implementation

Servo, Verso and Ladybird remain watch-list items, not v1 production candidates.
Flutter embedding is not a separate engine option and therefore is not evaluated
as an isolation solution.

## No preselected winner

Tauri is the preferred lightweight hypothesis, not an accepted decision.
Electron is the compatibility/control hypothesis, not automatically the secure
choice. The spike must compare observable properties instead of framework
marketing claims.

## Common test app

Build one deterministic, signed, network-disabled test package containing:

- HTML/CSS/JavaScript module loading;
- IndexedDB, CacheStorage and service-worker probes;
- WebAssembly feature probes;
- CSP and Trusted Types negative fixtures;
- attempted navigation, popup, download and external-protocol actions;
- attempted native IPC calls with zero grants;
- crash, hang and oversized-resource fixtures.

The same payload and assertions must be used for every candidate.

## Measurements

Record p50/p95 and raw samples for:

- cold start and warm start;
- idle resident memory and memory after one, five and ten apps;
- package/runtime download size;
- CPU during idle and active rendering;
- Web API/Wasm compatibility;
- time from upstream engine security release to user patch availability;
- app crash containment and host recovery;
- profile/storage separation;
- behaviour of CSP, custom schemes and secure contexts;
- accessibility and keyboard operation;
- reproducible build and SBOM coverage.

Do not use a single synthetic score. Publish the raw matrix and identify hard
cut criteria separately from preferences.

## Security gates

### Tauri

- App webviews have no generic plugin or custom-command access.
- Explicit capabilities do not overlap across window/webview labels.
- Registered application commands are restricted, despite Tauri's documented
  default exposure for registered commands unless the app manifest constrains
  them.
- Linux/Android remote-frame ambiguity is not used in the desktop T1 design.
- Isolation pattern is evaluated as defence in depth, not treated as proof that
  hostile content is safe.

### Electron

- Node integration disabled for all app content.
- Context isolation and renderer sandbox enabled.
- No broad preload bridge; every IPC sender and argument validated.
- Navigation, new windows, permission requests and external-open actions denied
  unless explicitly allowed.
- Current supported Electron line and measurable patch SLA required.

### WebView2 reference

- Distinct CoreWebView2Environment and user-data folder per app.
- No assumption that one WebView equals one renderer process.
- ProcessFailed, cleanup and profile deletion behaviour tested.

## Decision rule

A candidate may be accepted for T1 only if all security cut criteria pass on all
supported platforms. If Tauri fails compatibility but Electron passes, choose
Electron for T1 rather than weakening isolation. If no candidate passes, reduce
platform scope or app capability; do not relabel missing evidence as acceptable
risk.

## Deliverables

- [ ] reproducible spike repositories or directories
- [ ] exact versions and OS builds
- [ ] raw benchmark output
- [ ] negative security results
- [ ] engine patch/update responsibility matrix
- [ ] explicit rejected alternatives and migration trigger
