# Spike: Runtime-Evaluation common test app (ADR-006)

- Status: **framework-neutral payload + assertion spec only.** The four
  platform harnesses (Electron / CEF / WebView2 / Tauri) are a later,
  OS-specific step and are **not** in this directory.
- Implements the ADR-006 "Common test app" clause: **one** deterministic,
  network-disabled payload with **identical** assertions reused for every
  candidate runtime. See `docs/adr/ADR-006-runtime-evaluation-protocol.md`
  sections *Common test app*, *Measurements*, *Security gates*, *Deliverables*.
- Disjoint from `spike/cwap-canonical-json/` (that spike is untouched).

## What this is

A static, zero-dependency web payload plus a machine-readable expected-result
spec. Each candidate runtime loads the **same** `payload/index.html`, lets it
run, then reads `window.__spikeResults` and compares each probe against
`assertions.json`. Because the payload bytes are identical everywhere
(enforced by `verify-determinism.mjs`), any difference in results is a property
of the *runtime*, not of the test.

## Layout

```text
spike/runtime-eval/
  payload/
    index.html         entry; sets the CSP + Trusted-Types meta, loads app.mjs
    app.mjs            probe runner; writes window.__spikeResults + DOM
    probe-module.mjs   sibling module (proves static + dynamic ES import)
    sw.js              minimal service worker (no fetch handler, no network)
    style.css          static styling (no @import / no url() fetch)
  assertions.json      expected status per probe + host-level assertions
  asset-manifest.json  committed SHA256 of every payload asset (the byte lock)
  verify-determinism.mjs  determinism gate (pure SHA256 asset-manifest check)
  README.md            this file
```

## Probes (what the payload exercises)

Capability (must work on a correct Chromium-based runtime):
`module_loading`, `indexeddb`, `cachestorage`, `service_worker`, `webassembly`.

Security negative fixtures (secure outcome = `BLOCKED`):
`csp_eval` (no `unsafe-eval`), `csp_inline_script`, `trusted_types`
(`require-trusted-types-for 'script'`), `popup`, `external_protocol`,
`native_ipc_zero_grant` (no native bridge reachable without a grant).

Destructive fixtures (registered on `window.__spikeFixtures`, **never**
auto-run): `crash`, `hang`, `oversized`, `navigateExternal`,
`triggerDownload`. The harness triggers these in isolated runs while it
measures crash containment / host recovery / hang detection.

Status vocabulary: `PASS` / `BLOCKED` / `FAIL` / `READY` / `SKIP`
(defined in `assertions.json`).

## Determinism contract

- **No** `Date.now()`, `performance.now()`, or `Math.random()` value is ever
  written into `window.__spikeResults`. Probe order is fixed; each probe carries
  a stable integer `index`. The WebAssembly probe uses a fixed embedded module
  (`add(2,3)==5`), not a build step.
- The DOM is built with `createElement`/`textContent` only, so the payload stays
  Trusted-Types-clean while the TT probe deliberately triggers the violation in
  an isolated `try/catch`.
- `asset-manifest.json` pins the SHA256 of every payload byte. Regenerate it
  **only** after an intentional payload edit:

  ```bash
  node verify-determinism.mjs --update   # regenerate the byte lock
  node verify-determinism.mjs            # verify; exit 0 = identical, 1 = drift
  ```

  The gate hashes the payload twice (proving hashing determinism) and compares
  the aggregate + per-asset hashes against the committed manifest. Verified
  outcomes at authoring time: clean `exit 0`, tampered byte `exit 1`, missing
  manifest `exit 1`.

## How a future platform harness uses this

Each harness (Electron/CEF/WebView2/Tauri) is a thin native shell that:

1. **Verify the byte lock first** — run `node verify-determinism.mjs` in CI so
   every candidate provably loads identical payload bytes.
2. **Start with networking disabled** — this is the test subject, not an
   optional hardening. `connect-src 'none'` is set in the payload, but the
   harness MUST *also* start the runtime with egress blocked (e.g. Electron:
   deny in `session.webRequest.onBeforeRequest` / offline mode; CEF: no network
   service or a blocking `CefRequestHandler`; WebView2: a blocking
   `WebResourceRequested` filter; Tauri: no `http`/`shell` capabilities) and
   assert **zero** sockets/DNS during the run.
3. **Load `payload/index.html`** from the app's own scheme/local origin (not a
   remote URL). Apply the app-context security gate for that candidate from
   ADR-006 *Security gates* (e.g. Electron: `sandbox:true` + `contextIsolation:
   true` + `nodeIntegration:false` + `webSecurity:true`).
4. **Wait for completion**, then read `window.__spikeResults` (JSON object;
   also mirrored into the `#results-json` DOM node for out-of-process readers).
   A `undefined` result = the module never ran = harness FAIL.
5. **Compare** each `probes[i].status` against `assertions.json`
   `probes[id].expected` (an array of acceptable statuses). Record every
   deviation in the ADR-006 raw matrix — do **not** collapse to a single score.
6. **Assert the host-level facts** in `assertions.json.hostLevelAssertions`
   that the payload cannot see from JS (no external-protocol handler launched,
   no file written by `triggerDownload`, external navigation denied, crash
   contained). Trigger `window.__spikeFixtures.*` in **isolated** runs for these.

### Reading `window.__spikeResults`

Iterate the **assertion set**, never the list the payload happened to return
(issue #41 P1): a probe the payload omits must surface as `MISSING`, otherwise
every remaining entry is "expected", the deviation count stays 0, and the
harness reports success for a security control it never exercised.

```js
// inside the harness, after the page signals done (#status[data-state=done]):
const results = await webContents.executeJavaScript('window.__spikeResults'); // Electron example
const byId = new Map((results?.probes ?? []).map((p) => [p.id, p]));
for (const [id, rule] of Object.entries(assertions.probes)) {
  const probe = byId.get(id);
  if (!probe) {                       // control never exercised != control passed
    record(candidate, id, 'MISSING', 'NOT-MEASURED');
    continue;
  }
  const ok = rule.expected.includes(probe.status);
  // The category comes from assertions.json, never from the payload, so a
  // payload cannot relabel a security negative into a harmless category.
  record(candidate, id, probe.status, ok ? 'as-expected' : 'DEVIATION', rule.category);
}
```

### Exit-code contract (Electron harness, issue #41)

A run may only report `HARNESS_EXIT=0` when every control it claims to measure
was demonstrably exercised **and** passed. "Not measured" gets its own code so
it can never be read as a pass:

| code | meaning |
|---|---|
| 0 | every claimed control was exercised and passed |
| 1 | a control was exercised and **FAILED** |
| 2 | harness crash |
| 3 | watchdog timeout (180 s) |
| 4 | **NOT MEASURED** — a control was absent, incomplete or inconclusive |
| 5 | payload byte lock not satisfied; nothing was measured |

Precedence when several apply: 5 > 1 > 4 > 0. The rules live in
`harness/electron/harness-lib.js` (Electron-free on purpose) and are tested by
`tests/spike/adr006-harness.test.js`.

**Provenance note.** `harness/electron/RESULTS_WINDOWS_2026-07-22.md` was
produced by the **pre-#41** harness, which could exit 0 on an unexercised
control. It is kept unchanged as historical evidence; it is not a result of the
hardened harness, and the ADR-006 Windows row should be re-measured before it is
cited as settled. New runs write `RESULTS_<PLATFORM>_<run-date>.md` and never
overwrite an existing document.

## Measurement TODO hooks (harness-owned, ADR-006 *Measurements*)

The payload gives correctness; the harness owns the numbers. Wire these as
TODOs per candidate and publish raw samples (p50/p95), never a synthetic score:

- [ ] **cold start** — process spawn → `#status[data-state=done]`, fresh profile.
- [ ] **warm start** — same, second launch with warm caches.
- [ ] **idle resident memory** — after done, at rest.
- [ ] **memory after 1 / 5 / 10 apps** — N payload instances resident.
- [ ] **package / runtime download size** — shipped bytes per candidate.
- [ ] **CPU idle vs active render** — sample during idle and during render.
- [ ] **Web API / Wasm compatibility** — the probe matrix above.
- [ ] **engine security-release → user-patch latency** — measurable for
      self-bundled Chromium (Electron/CEF CI), only observable for WebView2.
- [ ] **crash containment / host recovery** — `__spikeFixtures.crash`.
- [ ] **hang / unresponsive handling** — `__spikeFixtures.hang`.
- [ ] **oversized-resource handling** — `__spikeFixtures.oversized`.
- [ ] **profile / storage separation** — distinct data dirs per app instance.
- [ ] **CSP / custom scheme / secure-context behaviour** — probe + scheme setup.
- [ ] **accessibility + keyboard operation** — table is reachable/operable.
- [ ] **reproducible build + SBOM coverage** — per-candidate build provenance.

## Non-goals / limits (honest scope)

- This directory contains **no** runtime and **no** native harness code — those
  need Win/Mac/Linux builds and are the next, platform-specific step.
- JS-only probes (`popup`, `external_protocol`, `native_ipc_zero_grant`) can
  only observe the in-page effect; the OS-level truth (handler launch, download
  write, ungranted-bridge call rejection) is asserted by the harness.
- `verify-determinism.mjs` checks **asset bytes**, not runtime results. It uses
  a pure SHA256 manifest because `jsdom` is not a dependency of this zero-dep
  repo; a harness that wants DOM-level determinism can add a jsdom check itself.
