# ADR-006 — Execution Findings (partial), 2026-07-21

- Status: **PARTIAL SPIKE EXECUTION — ADR-006 stays PROPOSED.**
- Owner decision (runtime selection): Marco — **not** made here.
- Feeds: ADR-006 (Native Runtime Evaluation Protocol), ADR-005 (T1→T2→T3), issue #23.
- Executed by: Vero (+ Quella evidence, Codie test-app artifact), 2026-07-21.

> **What this file is.** ADR-006 defines a measured cross-platform spike whose full
> execution needs Windows/macOS/Linux builds of four runtime harnesses. That full spike
> was **not** run today. This record captures the two parts that ARE executable now —
> (A) the **architecturally decidable hard-cut criteria** (no benchmark required) and (B)
> the **reproducible common test-app deliverable** — and states precisely what remains.
> Nothing here selects a runtime; ADR-006 stays PROPOSED until the measured matrix and
> per-platform security gates pass and Marco decides.

---

## A. Architecturally decidable hard-cuts (evidence-based, pre-benchmark)

Source: `docs/research/2026-07-21_RUNTIME_EVAL_evidence-refresh_ADR-006.md` (Quella,
2026-07-21; 18 primary sources, confidence-marked, no invented SLA numbers). This refreshes
and sharpens the ADR-006 embedded landscape (2026-07-16). The two ADR-006 hard-cuts that do
**not** require a benchmark:

1. **Shippable engine security-patch path** (project delivers a Chromium fix on its own cadence).
2. **Process-level, per-origin site isolation** available for the T3 hostile-content target.

| Candidate | Hard-cut (1) patch path | Hard-cut (2) site isolation (T3) | Verdict (pre-benchmark) |
|---|---|---|---|
| **Electron / bundled Chromium** | PASS — rebuild+re-release owns the cadence `[strong]` | PASS — Chromium site isolation + Origin-Agent-Cluster default `[strong]` | **Carries to measured spike (primary hypothesis)** |
| **CEF / bundled Chromium** | PASS — bundled Chromium; LTS branch path `[strong, SLA only qualitative]` | PASS — same Chromium lineage `[strong]` | **Carries to measured spike (fallback)** |
| **WebView2-direct** | **FAIL for T3** — Evergreen = Microsoft cadence; Fixed-Version only re-pins MS-built runtimes, no source-patch ownership `[strong]` | (is Chromium; inherits isolation) | **Rejected for T3** (Windows-only anyway) |
| **Tauri 2 / WRY / system WebView** | **FAIL for T3** — bound to OS/WebView-vendor cadence `[strong]` | **FAIL cross-platform** — WKWebView/WebKitGTK ≠ site-per-process `[plausible, model-level]` | **Not for APP-01 T3; correct for APP-02 (owner AI shell)** |
| **Servo / Verso / Ladybird** | n/a | n/a | **Watch-list 2028+** (Ladybird GA ~2028; Servo pre-production) `[strong]` |

**Partial conclusion (architectural only):** the T3 north star reduces the APP-01 runtime
shortlist to **bundled Chromium — Electron (primary) or CEF (fallback)**. Electron is the
compatibility/control hypothesis, **not** automatically the secure choice: it must still pass
every per-platform security cut criterion (`sandbox:true` + `contextIsolation:true` +
`nodeIntegration:false` + `webSecurity:true`; contextIsolation alone is insufficient) in the
measured spike. This is consistent with ADR-006's own decision rule and does not weaken it.

## B. Reproducible common test-app — DELIVERED

Source: `spike/runtime-eval/` (Codie, 2026-07-21). Framework-neutral, zero-dependency,
network-forbidden in the result path, deterministic. Satisfies ADR-006 deliverable
"reproducible spike repositories or directories" and provides the identical payload +
assertions every candidate harness must use.

- 12 probes: 5 capability (module-load, IndexedDB, CacheStorage, service-worker, Wasm),
  6 security-negatives expected BLOCKED (CSP eval/inline, Trusted-Types, popup,
  external-protocol, native-IPC-zero-grant across Electron/CEF/WebView2/Tauri/Node bridge
  points), plus non-auto-run destructive fixtures (crash/hang/oversized/navigate/download).
- `assertions.json` = expected status per probe + JS-invisible host-level assertions.
- `verify-determinism.mjs` = SHA256 asset byte-lock. **Discriminating gate — parent-verified
  today by revert-and-rerun:** clean `exit 0`, 1-byte tamper `exit 1`, restore `exit 0`;
  `node --check` clean on all JS. (Not decorative.)
- Honest scope: probe **runtime behaviour** (IndexedDB/SW/CSP/TT outcomes) is **not** yet
  executed in a real browser — no runtime exists in the repo (consistent with
  `docs/IMPLEMENTATION_STATUS.md`). First real execution belongs to the platform harness step.

## B.1 First measured Electron row — Windows (2026-07-22)

Source: `spike/runtime-eval/harness/electron/` (Codie, 2026-07-22). First real runtime
**execution** of the §B payload under a live Electron process; supersedes §B's "not yet
executed in a real browser" caveat for the Windows/Electron cell only. Every number below is
straight from the harness console output; the file `RESULTS_WINDOWS_2026-07-22.md` is generated
by the harness from the same run. **Not self-certified — Equalita/Data review open.**

- Runtime: **Electron 43.2.0** (Chromium 150.0.7871.129, Node 24.18.0), Windows x64.
- Gate: `sandbox:true` + `contextIsolation:true` + `nodeIntegration:false` + `webSecurity:true`,
  no preload; payload served from a privileged `app://` scheme (standard+secure), not `file://`.
- **Probes: 12/12 as-expected vs `assertions.json`, 0 deviations, harness exit 0.** (First run
  was 11/12: one `cachestorage` deviation, root-caused as a **payload** bug — the probe keyed
  `cache.put` on a non-`http(s)` scheme, which the Service Worker Cache spec rejects with
  `TypeError` on any Chromium. Fixed in the payload; byte-lock `asset-manifest.json` regenerated;
  determinism gate still discriminates 1-byte tamper → exit 1.)
- **6/6 security negatives BLOCKED** (CSP eval/inline, Trusted-Types, popup, external-protocol,
  native-IPC-zero-grant). Renderer crash **contained** (host survived + relaunched). Hang:
  NOT-OBSERVED within a 12 s bound (bound artifact, not proof of no detection).
- **Egress: 0 external requests** attempted/allowed, enforced at Electron
  `session.webRequest.onBeforeRequest` (deny every non-local scheme).

### Hardening applied beyond the four gate flags (measured)

The four flags are necessary but not sufficient; the harness now also applies, on every window:

- `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` — **closes the WebRTC egress bypass.**
  ICE/STUN/TURN open UDP peer connections directly through the OS, bypassing Chromium's HTTP
  network stack and therefore `onBeforeRequest` — this was the weakest egress pillar. Honest
  scope: this is a **set-policy structural closure** (applied 5× per run, 0 errors), **not** an
  empirically-triggered block; the payload opens no `RTCPeerConnection`/`getUserMedia`.
- `will-redirect` origin-pin (server-issued redirects), alongside `will-navigate`.
- `disableBlinkFeatures:'Auxclick'`; `setPermissionCheckHandler` + `setPermissionRequestHandler`
  both deny-all; `setWindowOpenHandler` deny; all downloads denied.

### T3 risk / honest vendor caveat — Electron is NOT designed for arbitrary untrusted content

The Electron security documentation states plainly that *"displaying arbitrary content from
untrusted sources poses a severe security risk that Electron is not intended to handle"* and that
Node integration must never be enabled for remote content `[extern: electronjs.org security
tutorial]`. This is a **direct caveat against the T3 (arbitrary foreign content) north star** and
must not be glossed over: the measured gate above hardens Electron substantially, but the vendor's
own stance is that Electron's threat model targets **trusted first-party** app content. This
**reinforces the ADR-005 staging discipline** — reach T1 (owner-controlled) and T2 (curated)
first; T3 requires either a runtime whose vendor supports that threat model, per-origin site
isolation carrying real weight, or an explicitly owned, audited residual-risk decision. It does
**not** by itself reject Electron (bundled Chromium still gives site isolation + an owned
patch cadence — §A), but it raises the evidentiary bar for the T3 cell specifically.

### Measurement-boundary honesty

- The egress proof is at **Chromium's network stack + `webRequest`**, not a kernel socket/DNS
  packet capture. There is no OS socket monitor here. With `nodeIntegration:false` + `sandbox:true`
  + no preload, app content has no native API to open a raw socket, and the WebRTC UDP path is now
  policy-closed — but "no raw socket either" remains a **structural argument, not a measurement**.
  A future run could add Windows ETW / `Get-NetTCPConnection` sampling to close this empirically.
- One OS (Windows), one runtime (Electron). macOS/Linux rows and the CEF fallback harness — the
  real two-way comparison ADR-006 needs — are NOT produced. Cold/warm start + idle memory are
  single-sample magnitudes, not p50/p95. ADR-006 stays **PROPOSED**; this is one measured row.

## C. What still REQUIRES the measured spike (unchanged ADR-006 deliverables)

Per-platform builds (Win/macOS/Linux) of the **Electron** and **CEF** harnesses that load
`spike/runtime-eval/payload/` under each candidate's security gate, with **egress actually
blocked and proven** (zero sockets/DNS — `connect-src 'none'` is the *test subject*, not the
proof), then:

- [ ] cold/warm start p50/p95 + raw samples;
- [ ] idle resident memory + memory after 1/5/10 apps;
- [ ] package/runtime download size; CPU idle/active;
- [ ] **median days from Chromium security release to a released bundle reaching the user**
  (measurable/steerable for Electron = own CI/release latency; observable-only for the
  rejected WebView2) — do not invent a number;
- [ ] crash containment + host recovery; profile/storage separation;
- [ ] per-platform pass of every Electron/CEF security gate in ADR-006;
- [ ] reproducible build + SBOM coverage; engine-patch responsibility matrix;
- [ ] raw matrix published, hard-cut criteria separated from preferences, **no synthetic score**.

## D. Provisional recommendation for Marco (decision remains yours)

1. **Accept the reduced shortlist** — carry **Electron (primary) + CEF (fallback)** into the
   measured spike; drop WebView2 and Tauri from APP-01 T3 (Tauri → APP-02); keep
   Servo/Ladybird as 2028+ watch-list. (Architectural evidence in §A supports this without a
   benchmark.)
2. **Next executable step** = build the **Electron** harness first against
   `spike/runtime-eval/` with the full security gate and proven egress-block, publish its raw
   matrix; then the CEF harness for a real two-way comparison. This is a platform-build task
   (needs the three OSes), not a desk task.
3. ADR-006 flips PROPOSED→ACCEPTED only when the measured matrix + per-platform gates pass and
   you record the selection. This file is **partial execution evidence**, not that decision.

---
*Coworker Research / Coworkerz · partial execution of ADR-006 · evidence: `docs/research/2026-07-21_RUNTIME_EVAL_evidence-refresh_ADR-006.md` + artifact `spike/runtime-eval/`.*
