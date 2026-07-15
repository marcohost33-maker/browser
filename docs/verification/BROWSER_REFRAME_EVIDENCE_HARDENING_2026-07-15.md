# Browser Reframe Evidence Hardening — 2026-07-15

- Status: REVIEW CANDIDATE
- Scope: corrective addendum for ADR-005, ADR-006, ADR-007 and the reframe
  checklist
- Authority: evidence proposal only; no runtime, package-format or release
  decision
- Supersedes: no accepted owner decision; corrects overbroad technical wording
  until the source ADRs are amended

## Purpose

A fresh primary-source review found several places where the current architecture
records turn a reasonable hypothesis into a stronger claim than the evidence
supports. This addendum makes those boundaries explicit so that the runtime and
package spikes test the right questions.

## Corrections that must be applied to the source ADRs

### 1. Site isolation is not automatically per-origin isolation

Chromium's standard isolation boundary is a **site**, normally scheme plus
registrable domain, not every origin. Two same-site origins can therefore share a
renderer unless stricter origin isolation is enabled and demonstrated.

Required correction:

- replace every use of "per-origin site isolation" with separate requirements
  for process-level site isolation and, where same-site tenants or apps must be
  mutually hostile, verified origin isolation;
- record the exact engine flags, policies and runtime observations used to prove
  the boundary;
- test cross-site, same-site cross-origin, sandboxed iframe, service-worker and
  popup cases rather than inferring isolation from process counts alone.

### 2. Patchability is an end-to-end latency property

Bundling Chromium gives the project control over rebuild and release timing, but
it does not prove fast patch delivery. A system WebView delegates engine delivery
to the platform vendor, but that alone does not prove unacceptable latency.

Required correction:

- measure time from upstream security release or vendor advisory to an installed
  fixed version on supported user systems;
- document vendor support windows, minimum enforceable versions, forced-update or
  block policy, rollback and emergency release capability;
- reject a candidate only when measured or contractually bounded patch latency
  exceeds the product SLA;
- for Electron, stay on a supported major line and account for its rolling
  support of the latest three stable major versions;
- treat a bundled engine that the project cannot rebuild, test and distribute
  promptly as a failed patch path.

### 3. The candidate list and prose must agree

ADR-006 lists Tauri/WRY, Electron and WebView2-direct, while its prose also relies
on CEF. CEF must either be an explicit measured candidate or be removed from the
claimed shortlist.

Recommended resolution:

- add CEF as a T3 control candidate with an explicit higher-engineering-cost
  hypothesis;
- do not assume CEF is safer than Electron; compare browser-process ownership,
  sandbox configuration, JS/native bridging, packaging, patch automation,
  accessibility and operational burden;
- retain WebView2-direct as a Windows reference, not as a cross-platform product
  candidate.

### 4. Runtime decisions must remain neutral until evidence exists

The current decision rule effectively says to choose Electron when Tauri fails
T3 criteria. That preselects a product before the common spike is run.

Required decision rule:

1. A runtime may ship T1 only if all T1 security and operational cut criteria
   pass on every supported platform.
2. A T1 runtime need not be the eventual T3 runtime if an explicit migration
   boundary, package compatibility contract and deprecation plan exist.
3. A runtime may be selected for T3 only after the hostile-content test suite,
   site/origin-isolation evidence, browser-product controls and patch SLA pass.
4. If no single candidate satisfies both stages, prefer an explicit split
   architecture over weakening a hard security criterion.
5. No framework wins because of language, package size, marketing claims or an
   unmeasured assumption about memory use.

## Hardened runtime gates

### Common gates

- one identical signed fixture and one versioned adversarial corpus;
- at least 30 isolated cold-start runs per OS/candidate, plus warm-start runs;
- raw samples, median, p95, dispersion and confidence intervals;
- memory measured for 1, 5 and 10 isolated app profiles;
- stable app identity and separate cookies, permissions, cache, IndexedDB,
  service workers and download areas;
- negative tests for navigation, popup, download, external protocols,
  certificates, permissions and native IPC;
- renderer crash, hang, memory pressure and host recovery evidence;
- exact engine/runtime versions, OS builds, flags and security-policy snapshots;
- measured end-to-end security-patch latency and documented emergency process;
- no synthetic aggregate score that can compensate for a failed hard gate.

### Electron-specific gates

- `nodeIntegration` disabled for all app content;
- context isolation and renderer sandbox enabled;
- no broad preload bridge; every message validates sender, frame and arguments;
- unique persistent session partition per app where persistent state is required;
- both permission-check and permission-request paths deny by default;
- navigation, new windows, downloads and external protocols deny by default;
- Electron security fuses reviewed at package time, including disabling unused
  Node/inspector entry paths and enabling ASAR integrity controls where used;
- actual site/origin isolation verified in the packaged application;
- supported Electron release line and upgrade cadence enforced in CI.

### Tauri/WRY-specific gates

- no remote URL receives Tauri API access;
- every registered command is constrained by the application manifest and exact
  capabilities, not merely registered;
- overlapping capabilities are analysed because permissions merge;
- window/webview labels, remote origins, scopes and command implementations are
  independently reviewed;
- platform WebView versions and vendor update paths are captured per OS;
- capability isolation is described as native-bridge containment, not proof that
  hostile web content is safe.

### WebView2-direct gates

- distinct `CoreWebView2Environment` and user-data folder per app;
- no assumption that one WebView equals one renderer process;
- process-group sharing, profile deletion, `ProcessFailed` recovery and version
  enforcement tested;
- Windows-only evidence is not generalized to macOS or Linux WebViews.

### CEF-specific gates

- Chromium sandbox remains enabled in browser and renderer subprocesses;
- no `--no-sandbox` release configuration;
- no generic JavaScript/native bridge;
- request, navigation, popup, permission, certificate and download handlers are
  default-deny;
- Chromium lineage, supported branch and automated rebuild/release SLA recorded;
- custom browser-product responsibility and maintenance cost are measured rather
  than treated as free flexibility.

## Hardened package-verifier gates

### Track A — Signed Web Bundle / IWA compatibility

- pin the exact specification revision and every parser/verifier/tool version;
- distinguish IWA Signed Web Bundles from Signed HTTP Exchanges: tooling for
  Signed Exchanges is not evidence of an IWA bundle verifier;
- treat IWA as a reference proposal and interoperability target, not a finished
  open cross-platform consumer standard;
- run the verifier in a least-privileged process;
- prefer validated, read-only serving from a content-addressed store over
  uncontrolled archive extraction;
- require malformed-CBOR, length, duplicate-resource, URL-canonicalization,
  algorithm, decompression and resource-limit fuzzing;
- use differential testing or a second independent implementation/oracle;
- prove update continuity, anti-downgrade, freeze/replay resistance, key rotation,
  revocation and key-loss recovery;
- do not claim `isolated-app://` guarantees for a custom `app://` implementation.

### Track B — Minimal manifest-root package

- publish a normative format specification before implementation;
- define one canonical manifest encoding and version-negotiation rule;
- bind every path, media type, size and content digest to the signature;
- reject traversal, absolute/UNC/device paths, symlinks, duplicate or undeclared
  files, Unicode normalization and case-fold collisions;
- enforce limits before allocation or extraction;
- separate package identity, publisher trust, update authority and local policy;
- fuzz and independently review the parser and update state machine;
- provide a migration path if later interoperability requires `.swbn`.

## Update model

Manual offline sideload remains the mandatory baseline. Any network update path
must be optional, separately consented and fully disableable.

The update system must:

- authenticate metadata and payloads separately;
- resist rollback, replay and indefinite freeze attacks;
- keep publisher trust separate from update-repository trust;
- stage and fully verify before activation;
- activate atomically and retain the last known-good version;
- require explicit approval for capability expansion;
- support key rotation, revocation and recovery without silently trusting a new
  key;
- send no hidden telemetry or mandatory heartbeat.

## Cross-layer AI boundary

`browser` must remain safe without an AI layer. When `browser-nigin` later reads
foreign pages, package signing and renderer sandboxing do not prevent prompt or
content injection. The integration contract must keep trusted instructions and
untrusted page data distinct, expose only capability-bounded actions and test
adversarial page content before any automation is enabled.

## Stale-state corrections

The current checklist and README contain historical statements about PR #17
being Draft or carrying an unmerged premise. PR #17 and PR #22 are merged. Those
statements must be replaced by current evidence references and any remaining
content-level migration debt, not PR-state assertions.

## Required next actions

1. Amend ADR-005 terminology for site versus origin isolation and patch latency.
2. Amend ADR-006 candidate list, neutral decision rule and candidate-specific
   gates.
3. Amend ADR-007 tooling distinction and verifier/update hardening.
4. Refresh the checklist and README against the current merged state.
5. Run the common runtime and verifier spikes; keep ADR-006/007 PROPOSED.
6. Require independent final-head review before accepting the amendments.

## Primary-source baseline

- Chromium Site Isolation design documentation.
- Electron security, sandbox, releases and fuses documentation.
- Tauri v2 capabilities documentation.
- Microsoft WebView2 process-model and user-data-folder documentation.
- WICG Isolated Web Apps proposal and pinned bundle tooling.
- The Update Framework specification and threat model.

No source above is itself product evidence. The repository must preserve raw
measurements, negative results, exact versions and independent review.
