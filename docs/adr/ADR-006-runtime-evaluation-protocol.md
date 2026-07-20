# ADR-006 — Native Runtime Evaluation Protocol

- Status: PROPOSED
- Date: 2026-07-14
- Depends on: ADR-005
- Decision owner: Marco

This ADR remains PROPOSED: it defines the measured spike and does not itself
select a runtime. ADR-005 (ACCEPTED) sets the T1 → T2 → T3 target; this protocol
measures which runtime can carry the programme to the T3 target state.

## Question

Which runtime can host T1 owner-controlled offline webapps with the smallest
maintainable attack surface while preserving required compatibility on Windows,
macOS and Linux, and — because T3 (arbitrary foreign content) is the accepted
target state — can also inherit process-level site isolation and ship engine
security patches on the project's own cadence?

## Candidates

1. Tauri 2 / WRY / system WebView
2. Electron / bundled Chromium
3. Windows-only WebView2-direct reference implementation
4. CEF (Chromium Embedded Framework) / bundled Chromium — measured under the same
   hard cut and security criteria as Electron, not carried as a conclusion-only
   "Electron or CEF" mention (ChatGPT cross-family correction 2026-07-15).

Servo, Verso and Ladybird remain watch-list items, not v1 production candidates.
Flutter embedding is not a separate engine option and therefore is not evaluated
as an isolation solution.

## No preselected winner

No runtime is decided here; the spike compares observable properties instead of
framework marketing claims. Given the accepted T3 target (ADR-005), the shortlist
focus for APP-01 hostile-content isolation is Chromium-based (Electron or CEF),
which inherits process-level site isolation and a project-controlled patch
cadence. Electron is the compatibility/control hypothesis, not automatically the
secure choice, and must still pass every security cut criterion. Tauri remains a
candidate for the owner-controlled AI shell (APP-02), not for APP-01 T3, because
a system WebView does not provide equivalent cross-origin process isolation for
arbitrary foreign content.

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

### CEF

- Sandbox active; `--no-sandbox` is prohibited.
- No generic JavaScript/native bridge exposed to app content.
- Navigation, permissions, certificate handling and downloads denied by default.
- Chromium lineage, branch support and a rebuild/re-release SLA demonstrated.
- Browser-product maintenance and packaging cost measured, not assumed.

## Hard cut criteria

A candidate that fails any of these is rejected regardless of its other scores:

- a shippable engine security-patch path: the project can deliver an upstream
  engine security fix to users on its own release cadence (for a bundled
  Chromium, by rebuilding and re-releasing; a system WebView whose patch latency
  is bound to the host OS vendor fails this criterion for the T3 target);
- process-level, per-origin site isolation available for the T3 hostile-content
  target, not only default-deny IPC;
- every app-context security gate below passing on all supported platforms.

## Decision rule

A candidate may be accepted for T1 only if all hard cut criteria and security cut
criteria pass on all supported platforms, and only if it also keeps a credible
path to the T3 target (site isolation and engine patch cadence). If Tauri fails
compatibility or the T3 site-isolation/patch-path criteria but Electron passes,
choose Electron rather than weakening isolation. If no candidate passes, reduce
platform scope or app capability; do not relabel missing evidence as acceptable
risk.

## Primary-source landscape (Quella 2026-07-16)

This ADR stays **PROPOSED**. The primary-source review below **focuses** the spike;
it does **not** replace the measured spike. Every measured cut criterion above still
has to be executed; nothing here selects a runtime. Confidence markers are carried
over honestly from the source review.

- **Only bundled Chromium unites real Chromium site isolation *and* an
  owner-controlled patch cadence.** Electron (JS/pragmatic) or CEF (C++/heavier) are
  the two paths that ship their own Chromium and let the project decide which version
  reaches users. `[strong evidence]`
- **Adversarial precision on system WebView (do not drop this).** System WebView is
  **not** categorically "without isolation": WebView2 *is* Chromium and **inherits
  Chromium site isolation**. The defensible reasons to exclude a system WebView for
  the T3 target are two others: (1) **no owner patch SLA** — WebView2 is Evergreen,
  updated automatically on Microsoft's cadence (Fixed-Version gives control only at
  the cost of self-repackaging and losing auto-patch); WKWebView/WebKitGTK are bound
  to the user's OS update cadence; and (2) **platform inconsistency** — WKWebView
  (WebKit) and WebKitGTK do not offer the same site-per-process guarantee as Chromium,
  so the isolation level varies by OS/version and is outside project control. This
  sharpens the earlier prose (which over-stated "no cross-origin isolation").
  `[strong evidence for patch control; platform-inconsistency H2H = plausible, not a
  direct primary isolation benchmark]`
- **Pin the Electron security baseline hard:** `sandbox: true` +
  `contextIsolation: true` + `nodeIntegration: false` + `webSecurity: true`.
  `contextIsolation` **alone is insufficient** — without the sandbox the renderer runs
  with full system access and any V8 memory bug becomes RCE. `[strong evidence]`
- **Site vs origin.** Chromium's default isolation boundary is a **site** (scheme +
  eTLD+1), not a full origin; multiple origins of one site can share a renderer.
  Per-origin process locking is available via **Origin-Agent-Cluster**, which is now
  the default (merged into the HTML standard) and effectively disables
  `document.domain`. For mutually hostile same-site tenants, origin-keyed isolation
  must be enabled and demonstrated, not inferred from process counts. `[strong
  evidence]`
- **Servo/Verso and Ladybird are not production-ready in 2026** (Ladybird Stable
  targeted ~2028; Servo 2026 = embedding demos / minimal shell). Keep them as
  **2028+ watch-list** items, not v1 candidates. `[strong evidence]`
- **Patch-SLA confidence is uneven — mark it.** The CEF patch SLA is only qualitative
  ("tracks Chromium"), with **no** primary-sourced number; do not carry it as a hard
  SLA. The Electron "~1–2 weeks after Chromium stable" figure is a secondary snippet,
  **not** verbatim in the fetched Electron Timelines page; treat it as plausible, not
  a guarantee. Do **not** invent a number. Proposed measurable metric for this ADR:
  **"median days from Chromium security release to a released bundle reaching the
  user"** — for Electron this is the project's own CI/release latency (measurable and
  steerable); for WebView2 it is Microsoft's rollout (only observable). `[metric =
  our proposal, plausible]`

Primary sources (from the Quella 2026-07-16 deliverable):

- Electron: <https://www.electronjs.org/docs/latest/tutorial/electron-timelines> ·
  <https://www.electronjs.org/docs/latest/tutorial/security> ·
  <https://www.electronjs.org/docs/latest/tutorial/sandbox>
- Chromium isolation:
  <https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md>
  · <https://www.chromium.org/Home/chromium-security/site-isolation/> ·
  <https://github.com/WICG/origin-agent-cluster>
- WebView2 patch model:
  <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version>
  ·
  <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution>
- Tauri/WRY: <https://v2.tauri.app/security/future/> ·
  <https://github.com/tauri-apps/wry>
- Servo/Ladybird: <https://en.wikipedia.org/wiki/Ladybird_(web_browser)> ·
  <https://www.phoronix.com/news/Servo-January-2026>

## Deliverables

- [ ] reproducible spike repositories or directories
- [ ] exact versions and OS builds
- [ ] raw benchmark output
- [ ] negative security results
- [ ] engine patch/update responsibility matrix
- [ ] explicit rejected alternatives and migration trigger
