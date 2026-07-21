# Runtime Evaluation — Primary-Source Evidence Refresh (ADR-006)

- Date: 2026-07-21
- Author: Coworker Research / Coworkerz (Quella, Wissens-Steward)
- Scope: verify + refresh the **architecturally decidable** hard-cut evidence for ADR-006.
  Performance benchmarks (cold start, memory, CPU, size) are **out of scope** — those need
  real signed builds (the measured spike).
- Refreshes: the "Primary-source landscape (Quella 2026-07-16)" block inside
  `docs/adr/ADR-006-runtime-evaluation-protocol.md`.
- Confidence markers per statement: `[strong]` = primary source states it directly ·
  `[plausible]` = supported but inferred / not a direct benchmark · `[weak]` = single
  secondary source, treat as lead only.
- Discipline: **no invented numbers**, especially no patch-SLA days. Where the 2026-07-16
  landscape said "plausible, not verbatim", that is preserved, not upgraded.

---

## TL;DR (architectural verdict, pre-benchmark)

| Candidate | (1) Own patch cadence | (2) Process per-origin isolation (T3) | Hard-cut architectural verdict |
|---|---|---|---|
| **Electron / bundled Chromium** | YES — rebuild + re-release own bundle | YES (Chromium site isolation + OAC default) | **PASSES** the two architectural hard-cuts; must still pass measured security gates + benchmark |
| **CEF / bundled Chromium** | YES — same, via CEF release branch rebuild | YES (same Chromium lineage) | **PASSES** architecturally; higher C++ rebuild/maintenance cost |
| **WebView2-direct (Evergreen)** | NO — bound to Microsoft's rollout | YES (WebView2 *is* Chromium) | **FAILS** hard-cut (1) for T3: no owner patch cadence |
| **WebView2-direct (Fixed Version)** | PARTIAL — select from MS-published versions + self-repackage; not own-source rebuild | YES (Chromium) | **FAILS** hard-cut (1) as stated (project cannot ship its *own* engine fix; only re-pin an MS build) |
| **Tauri 2 / WRY / system WebView** | NO — OS/WebView vendor cadence by design | NOT equivalent cross-platform (WebKit ≠ site-per-process) | **FAILS** both architectural hard-cuts for APP-01 T3; remains valid for APP-02 owner shell |

Architecturally, only **bundled Chromium (Electron or CEF)** clears both engine-patch-cadence
and process-level-isolation hard cuts for the T3 target. This confirms the 2026-07-16 landscape;
nothing below reverses it. `[strong]`

---

## 1. Electron / bundled Chromium

**(a) Shippable engine security-patch path** — `[strong]`
Electron bundles its own Chromium; the project rebuilds and re-releases, so it decides which
engine version reaches users on its own cadence. Support policy (verbatim): *"The latest three
stable major versions are supported by the Electron team"* and *"We only support the latest minor
release for each stable release series."* Cadence: *"Electron's cadence between major version
releases is 8 weeks long"* (4-week alpha + 4-week beta before stable).
Source: electron-timelines (primary).

**Patch-latency figure — NOT verbatim `[plausible]`.** The Electron Timelines page does **not**
state a "~1–2 weeks after Chromium stable" number. It only says *"The latest stable release
unilaterally receives all fixes from `main`, and the version prior to that receives the vast
majority of those fixes as time and bandwidth warrants."* Do **not** carry a hard SLA. The
measurable metric proposed by ADR-006 stands: **median days from Chromium security release to a
released bundle reaching the user** — for Electron this is the project's own CI/release latency
(steerable). `[metric = our proposal, plausible]`

**(b) Process-level per-origin site isolation (T3)** — `[strong]`
Electron inherits Chromium's site isolation (see §6). Boundary is a *site* (scheme + eTLD+1) by
default; per-*origin* locking via Origin-Agent-Cluster, now default. Must be *demonstrated* in the
spike, not inferred from process counts.

**(c) Maintenance / license / packaging cost** — `[strong]`
JS/Node toolchain, prebuilt Chromium bundle — no C++ Chromium rebuild required. Packaging via
electron-builder/forge ecosystem. Lowest engine-maintenance burden of the bundled-Chromium paths.
License: MIT (Electron); bundled Chromium is BSD-family. `[plausible — license not re-fetched
this pass]`

**(d) Current supported lines (2026-07)** — `[strong]`
Supported majors: **Electron 41, 42, 43**. Latest stable **v43.1.1** (2026-07-14), shipping
**Chromium 150.0.7871.114**, Node 24.18.0, V8 15.0. Electron 43.0 (2026-07-02) moved Chromium
148 → 150.
Security defaults (verbatim from security tutorial, Electron 20.0.0+): process sandboxing
**enabled**, contextIsolation **enabled** (since 12.0.0), nodeIntegration **disabled** (since
5.0.0), webSecurity **enabled**. Critical caveat (verbatim): *"Disabling context isolation for a
renderer process by setting `nodeIntegration: true` also disables process sandboxing for that
process"* — i.e. contextIsolation alone is **insufficient**; the baseline must pin
`sandbox: true` + `contextIsolation: true` + `nodeIntegration: false` + `webSecurity: true`
together.
Sources: electron-43-0 blog, releases.electronjs.org, security tutorial (all primary).

**(e) Servo/Verso/Ladybird** — not applicable to this candidate (see §6).

---

## 2. CEF (Chromium Embedded Framework) / bundled Chromium

**(a) Shippable engine security-patch path** — `[strong]`
CEF ships its own Chromium; the project rebuilds a CEF release branch and re-releases on its own
cadence. Verbatim: within a release branch *"the CEF API is 'frozen' and generally only
security/bug fixes are applied,"* and *"CEF release branches can include patches to Chromium/Blink
source if necessary."* So CEF can carry engine-level fixes.
**New detail (refines 2026-07-16):** CEF branches track Chromium milestones (MXX); support runs
from Chromium beta entry to stable exit, and *"every sixth branch starting with M138"* enters LTS,
which *"continue[s] to receive platform-agnostic security fixes for ~8 additional months."*
Source: cef branches_and_building (primary).
**No hard SLA number** — the patch cadence is qualitative ("tracks Chromium"). Do not invent a
figure. `[strong for mechanism; SLA = qualitative only]`

**(b) Process-level per-origin site isolation (T3)** — `[strong]`
Same Chromium lineage as Electron → same site isolation + OAC. Version numbering ties CEF major to
Chromium major (`X.Y.Z+gHHHHHHH+chromium-A.B.C.D`).

**(c) Maintenance / license / packaging cost** — `[strong]`
Highest of the candidates. Verbatim: building CEF *"demands C++ compilation capabilities and
platform-specific toolchains (Visual Studio, Xcode, or Linux development environments),
representing a significant technical investment compared to using prebuilt binaries."* Legacy
branch builds are unsupported. This is the ADR-006 CEF security-gate item "browser-product
maintenance and packaging cost measured, not assumed" — architecturally it is a real,
project-owned C++ rebuild burden. License: BSD. `[strong]`

**(d) Current supported lines (2026-07)** — `[plausible]`
CEF majors follow Chromium majors; with Chromium at 150 (per Electron 43), the current CEF stable
branch is expected in the ~M148–M150 range, with M138 as an active LTS branch. Exact
current-branch numbers were **not re-fetched** to a verbatim primary value this pass — flag for
the spike to pin the exact CEF build. `[plausible — no verbatim current-branch number]`

**(e) Servo/Verso/Ladybird** — n/a.

---

## 3. WebView2-direct (Windows-only reference implementation)

**(a) Shippable engine security-patch path** — `[strong]` **FAIL for T3**
WebView2 **is** Chromium, but the project does **not** control its patch cadence.
- **Evergreen** (recommended, default): verbatim — *"the WebView2 Runtime is automatically updated
  on client machines"*; the app *"cannot specify that a particular version of the WebView2 Runtime
  is required."* Patch cadence = Microsoft's rollout, observable but not steerable by the project.
- **Fixed Version**: gives version *control* but at a cost — verbatim: *"The WebView2 Runtime isn't
  automatically updated on clients, so … you must periodically update your app together with the
  updated WebView2 Runtime."* Crucially the project selects among **Microsoft-published** runtime
  versions and self-repackages; it cannot rebuild Chromium from source to ship its **own** fix.
  So Fixed Version still **fails** the hard cut as ADR-006 phrases it (project delivers its own
  engine fix on its own cadence) — it converts auto-patch into manual re-pinning, not into
  source-level patch ownership.
Source: learn.microsoft webview2 evergreen-vs-fixed-version (primary, doc updated 2026-06-12).

**(b) Process-level per-origin site isolation (T3)** — `[strong]`
WebView2 inherits Chromium site isolation (it is Edge/Chromium). Isolation itself is **not** the
disqualifier — the patch cadence is. (This preserves the 2026-07-16 adversarial correction: do
not overstate "no isolation" for WebView2.) `[strong]`

**(c) Maintenance / license / packaging cost** — `[strong]`
Evergreen: lowest disk/packaging cost (shared runtime, hard-linked with Edge on eligible systems).
Fixed Version: larger footprint, manual runtime management. Windows-only — no macOS/Linux coverage,
so it cannot satisfy ADR-006's all-supported-platforms rule on its own.

**(d) Current supported lines (2026-07)** — `[strong]`
Evergreen vs Fixed Version model unchanged since the 2026-07-16 landscape (doc last updated
2026-06-12; no change in the 07-16 → 07-21 window). Evergreen preinstalled on all Windows 11 and
eligible Windows 10 devices.

**(e) Servo/Verso/Ladybird** — n/a.

---

## 4. Tauri 2 / WRY / system WebView

**(a) Shippable engine security-patch path** — `[strong]` **FAIL for T3**
By design Tauri does **not** bundle the WebView. Verbatim (Tauri security docs): *"Tauri's approach
is to rely on the operating system WebView and not bundling the WebView into the application
binary,"* and Tauri frames OS/WebView maintainers as *faster* to patch than app developers who
bundle. That is a legitimate design trade — but it means **the project cannot ship an engine fix on
its own cadence**; patch latency is bound to the host OS / WebView vendor. That is exactly the
ADR-006 hard-cut failure condition for the T3 target.
Source: v2.tauri.app/security (primary).

**(b) Process-level per-origin site isolation (T3)** — `[strong` for the direction; `plausible]`
for the cross-platform benchmark.
WRY uses **WebView2 (Chromium)** on Windows, but **WKWebView (WebKit)** on macOS and
**webkit2gtk** on Linux. WebKit/WebKitGTK do **not** provide the same site-per-process guarantee as
Chromium, so the isolation level *varies by OS and version and is outside project control*. Tauri's
own security page does **not** claim process-level per-origin isolation for foreign content ("not
discussed"). For arbitrary hostile foreign content (T3), this is **not** equivalent to Chromium
site isolation. `[strong that the model differs; a direct cross-platform isolation benchmark is not
primary-sourced — mark plausible]`

**(c) Maintenance / license / packaging cost** — `[strong]`
Smallest binaries (no bundled engine); Rust core. Cost shifts to capability/permission/scope
manifest correctness and to platform-WebView variance testing. License: MIT/Apache-2.0.

**(d) Current supported lines / security model (2026-07)** — `[strong]`
WRY **0.55.1** (2026-05-04); tauri-runtime-wry 2.11.3; Tauri core in the 2.6.x line. Security model:
Rust core = *"full access to all available system resources and is not constrained"* (privileged);
WebView = *"only access to exposed system resources via the well-defined IPC layer"*; controlled by
**capabilities** (which commands the frontend may call), **permissions**, **scopes**, and the
**isolation pattern** (defence in depth). This matches ADR-005's constraint: default-deny IPC
limits one escalation path but is **not** the full browser security product for unknown code.
Sources: v2.tauri.app/security, v2.tauri.app/reference/webview-versions, tauri-apps/wry (primary).

**Verdict:** correctly scoped by ADR-005/006 to the **owner-controlled AI shell (APP-02)**, not to
APP-01 T3. `[strong]`

---

## 5. Servo / Verso / Ladybird — production-readiness watch-list

- **Ladybird**: roadmap **2026 alpha / 2027 beta / 2028 general release** (project's own stated
  roadmap). As of 2026-06 the project **closed public contributions** ahead of first alpha (quality
  + security hardening). **Not a v1 production candidate.** `[strong]`
- **Servo**: shipped **v0.1.0** of the `servo` crate on crates.io (2026-04-13) — usable as an
  *embedding library*, still a research-to-production transition, not a production engine.
  Independent readiness analysis: Servo completes ~22 features/year vs the Baseline "Widely
  Available" set growing ~52/year (i.e. falling behind, not catching up). **Not production-ready
  2026.** `[strong for status; the feature-rate figure is a third-party analysis — plausible]`
- **Verso**: Servo-based shell — same immaturity class; embedding-demo tier. `[plausible]`

**Confirmed: keep Servo/Verso/Ladybird as a 2028+ watch-list**, re-evaluate at Ladybird beta (2027)
and Servo API stabilization. `[strong]`

---

## What is architecturally decidable NOW (without benchmark)

1. **The two ADR-006 architectural hard cuts already discriminate.** Own-cadence engine patch +
   process-level per-origin isolation are satisfiable **only** by bundled Chromium (Electron or
   CEF). System WebView (WebView2-direct Evergreen; Tauri) fails hard-cut (1) by construction; Tauri
   also fails (2) cross-platform. This does not need a build to establish. `[strong]`
2. **Electron vs CEF is a maintenance-cost decision, not an isolation/patch-capability decision** —
   both inherit the same Chromium isolation and both can ship own-cadence fixes; CEF adds a
   project-owned **C++ Chromium rebuild burden** (primary-sourced), Electron does not. `[strong]`
3. **The Electron security baseline is fixed and verifiable from docs**: sandbox + contextIsolation
   + nodeIntegration:false + webSecurity:true, with contextIsolation-alone being insufficient. This
   can be asserted and gate-tested independent of benchmarks. `[strong]`
4. **WebView2 Fixed Version does not rescue the T3 patch-path** for a system-WebView approach: it is
   version *re-pinning* of MS-built runtimes, not source-level patch ownership. `[strong]`
5. **Watch-list runtimes are out for v1** on stated roadmaps alone (Ladybird GA 2028; Servo
   pre-production). `[strong]`

## What still REQUIRES the measured spike (build needed)

- **Patch-latency numbers**: median days from Chromium security release to a released bundle
  reaching the user — Electron/CEF = the project's own CI/release latency (must be *measured*, not
  quoted; no SLA number exists to cite). `[our metric, plausible]`
- **Origin-Agent-Cluster demonstration**: that origin-keyed process locking is actually *achieved*
  for mutually-hostile same-site tenants — must be shown via process inspection, not inferred.
- **Every app-context security gate** on Windows/macOS/Linux: zero-grant IPC, navigation/popup/
  download/external-protocol denial, CSP + Trusted Types negative fixtures, ProcessFailed/crash
  containment, per-app profile/storage separation.
- **Performance matrix**: cold/warm start, idle + N-app resident memory, package size, CPU,
  Web-API/Wasm compatibility, reproducible-build + SBOM coverage.
- **CEF exact current branch + rebuild SLA** and packaging cost, measured on a real build.

## Freshness check (2026-07-16 → 2026-07-21)

Searched for changes in the 5-day window on each candidate; **negative result, no material change**:
- Electron: no new major since v43.1.1 (2026-07-14). Searched "Electron 43 Chromium 150 security
  July 2026" — latest point release predates the prior landscape. **No update.**
- WebView2: evergreen-vs-fixed-version doc last updated 2026-06-12 (unchanged in window). **No
  update.**
- Chromium isolation / Origin-Agent-Cluster: OAC still "enabled by default" per primary doc. **No
  update.**
- Tauri/WRY: WRY 0.55.1 (2026-05-04) still latest per releases page. **No update.**
- Servo/Ladybird: roadmaps (Ladybird 2028 GA; Servo v0.1.0 Apr 2026) unchanged. **No update.**
The 2026-07-16 landscape stands; this pass *sharpens* CEF LTS detail and the WebView2-Fixed-Version
nuance, and pins Electron 43.1.1 / Chromium 150 as current.

## Provenance discipline

- All engine/security-model statements above are **external** (vendor primary docs / project
  roadmaps), not Coworkerz measurements. No Coworkerz build or benchmark exists yet — those are the
  ADR-006 spike deliverables and are explicitly **not** claimed here.
- Single-source / non-verbatim items are marked: Electron "~1–2 weeks" figure (rejected as
  non-verbatim, kept as plausible only); CEF SLA (qualitative only); CEF current-branch number (not
  re-fetched); Tauri cross-platform isolation benchmark (model-level, not a direct benchmark); Servo
  feature-rate (third-party analysis).
- Adversarial check applied: actively tried to *rescue* the system-WebView candidates (WebView2
  Fixed Version; Tauri) against hard-cut (1) — both fail on primary-source reading, not on
  assumption. Weakest evidence link = the Tauri cross-platform per-origin isolation claim (no direct
  primary benchmark) and CEF's exact current branch (not pinned this pass).

---

## Source register (primary unless noted)

- Electron support/cadence: <https://www.electronjs.org/docs/latest/tutorial/electron-timelines> ·
  <https://releases.electronjs.org/> · <https://releases.electronjs.org/schedule>
- Electron 43 / Chromium 150: <https://www.electronjs.org/blog/electron-43-0>
- Electron security defaults: <https://www.electronjs.org/docs/latest/tutorial/security>
- CEF branch/release model + build cost:
  <https://chromiumembedded.github.io/cef/branches_and_building.html> ·
  <https://github.com/chromiumembedded/cef>
- Chromium site isolation + Origin-Agent-Cluster:
  <https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md> ·
  <https://www.chromium.org/Home/chromium-security/site-isolation/> ·
  <https://github.com/WICG/origin-agent-cluster>
- WebView2 Evergreen vs Fixed Version:
  <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version> ·
  <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution>
- Tauri 2 security / WebView versions / WRY: <https://v2.tauri.app/security/> ·
  <https://v2.tauri.app/reference/webview-versions/> · <https://github.com/tauri-apps/wry> ·
  <https://v2.tauri.app/release/>
- Ladybird roadmap: <https://ladybird.org/> ·
  <https://en.wikipedia.org/wiki/Ladybird_(web_browser)> *(secondary, roadmap corroboration)*
- Servo status: <https://servo.org/blog/2026/04/13/servo-0.1.0-release/> ·
  <https://webtransitions.org/servo-readiness/> *(third-party analysis — feature-rate figure)*

---
*Coworker Research / Coworkerz — evidence refresh only; selects no runtime. ADR-006 remains
PROPOSED. Every measured cut criterion in ADR-006 still has to be executed.*
