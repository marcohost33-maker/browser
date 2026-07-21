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
