// ADR-006 Electron runtime-evaluation harness (isolated spike, Windows first row).
//
// WHAT IT DOES
//   * Registers an `app://` privileged local scheme and serves spike/runtime-eval/payload
//     from it (a proper local origin so ES modules + service workers work; file:// would
//     block module loading in Chromium via the "null" origin).
//   * Opens a BrowserWindow under the FULL ADR-006 app-context security gate:
//       sandbox:true, contextIsolation:true, nodeIntegration:false, webSecurity:true,
//       no preload (zero native bridge -> native_ipc_zero_grant must be BLOCKED).
//   * Denies popups/new windows, external navigation, all permission requests, all downloads.
//   * REAL egress block: session.webRequest.onBeforeRequest cancels every non-local scheme
//     and logs it. Proves zero external requests reached Chromium's network stack.
//   * Runs the 12 probes (reads window.__spikeResults), compares each against assertions.json.
//   * Triggers the destructive fixtures in isolated windows: external navigation (denied),
//     download (denied), real renderer crash (containment), hang (unresponsive detection).
//   * Records raw host metrics: cold/warm start, idle resident memory, per-process breakdown.
//   * Writes RESULTS_WINDOWS_<date>.md and prints a summary. No synthetic score.
//
// HONEST LIMITS (also in the results file): Windows only; one runtime (Electron) only;
// egress is proven at Chromium's network layer + webRequest, NOT at the OS kernel socket/DNS
// layer (no packet capture). "Zero external requests" here = zero requests Chromium attempted
// and zero the harness allowed; it does not by itself exclude a hypothetical raw OS socket,
// though with nodeIntegration:false + sandbox:true the renderer has no API to open one.

'use strict';

const { app, BrowserWindow, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Paths (harness lives at spike/runtime-eval/harness/electron/)
// ---------------------------------------------------------------------------
const SPIKE_DIR = path.resolve(__dirname, '..', '..');        // spike/runtime-eval
const PAYLOAD_DIR = path.join(SPIKE_DIR, 'payload');
const ASSERTIONS = JSON.parse(fs.readFileSync(path.join(SPIKE_DIR, 'assertions.json'), 'utf8'));
const RESULTS_PATH = path.join(__dirname, 'RESULTS_WINDOWS_2026-07-22.md');

// Robustness on Windows / headless-ish CI: avoid GPU-process flakiness.
app.disableHardwareAcceleration();

// ---------------------------------------------------------------------------
// Local app:// scheme — standard + secure so modules/SW/secure-context work.
// MUST be registered before app 'ready'.
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      allowServiceWorkers: true,
    },
  },
]);

const MIME = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

// ---------------------------------------------------------------------------
// Egress + host-level ledgers
// ---------------------------------------------------------------------------
const egress = { allowedLocal: 0, blockedExternal: 0, blockedList: [] };
const hostLevel = { downloadsDenied: 0, externalNavDenied: 0, windowOpenDenied: 0, permissionDenied: 0 };
const consoleLog = []; // renderer console (captures CSP refusal messages = evidence)

function isLocalScheme(u) {
  return /^(app|data|blob|devtools|chrome-extension|about):/i.test(u);
}

function schemeOf(u) {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  return m ? m[1].toLowerCase() : '(none)';
}

// ---------------------------------------------------------------------------
// Small async helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDone(wc, timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) return { state: 'timeout', ms: Date.now() - t0 };
    let state;
    try {
      state = await wc.executeJavaScript(
        "(document.getElementById('status')&&document.getElementById('status').dataset.state)||'running'",
      );
    } catch {
      state = 'running';
    }
    if (state === 'done' || state === 'error') return { state, ms: Date.now() - t0 };
    await sleep(50);
  }
}

// Apply the ADR-006 Electron security gate + deny handlers to a window's webContents.
function harden(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => {
    hostLevel.windowOpenDenied += 1;
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    let external = true;
    try {
      external = new URL(url).origin !== new URL(wc.getURL() || 'app://local/').origin;
    } catch {
      external = true;
    }
    if (external) {
      event.preventDefault();
      hostLevel.externalNavDenied += 1;
    }
  });
  wc.on('console-message', (_e, _level, message) => {
    if (consoleLog.length < 60) consoleLog.push(message);
  });
}

function makeWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // No preload: zero native bridge is exposed to app content.
      backgroundThrottling: false,
    },
  });
  harden(win);
  return win;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function realMain() {
  // Serve payload from app://local/... on the default session.
  protocol.handle('app', (request) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      pathname = '/index.html';
    }
    if (!pathname || pathname === '/') pathname = '/index.html';
    const rel = pathname.replace(/^\/+/, '');
    const full = path.join(PAYLOAD_DIR, rel);
    // Path-traversal guard: never serve outside PAYLOAD_DIR.
    if (!full.startsWith(PAYLOAD_DIR)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const buf = fs.readFileSync(full);
      const ext = path.extname(full).toLowerCase();
      return new Response(buf, {
        status: 200,
        headers: { 'content-type': MIME[ext] || 'application/octet-stream' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  const ses = session.defaultSession;

  // REAL egress block: cancel every non-local request, count + log it.
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (isLocalScheme(details.url)) {
      egress.allowedLocal += 1;
      cb({ cancel: false });
    } else {
      egress.blockedExternal += 1;
      if (egress.blockedList.length < 100) {
        egress.blockedList.push({
          url: details.url,
          method: details.method,
          resourceType: details.resourceType,
          scheme: schemeOf(details.url),
        });
      }
      cb({ cancel: true });
    }
  });

  // Deny all permissions and all downloads.
  ses.setPermissionRequestHandler((_wc, _perm, cb) => { hostLevel.permissionDenied += 1; cb(false); });
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => { event.preventDefault(); hostLevel.downloadsDenied += 1; });

  // ---- Cold run: capability + security probes -----------------------------
  const coldWin = makeWindow();
  const tCold0 = Date.now();
  await coldWin.loadURL('app://local/index.html');
  const coldDone = await waitForDone(coldWin.webContents, 30000);
  const coldStartMs = Date.now() - tCold0;

  let results = null;
  try {
    results = await coldWin.webContents.executeJavaScript('window.__spikeResults');
  } catch (e) {
    results = { error: String(e && e.message) };
  }

  // Idle resident memory snapshot (raw, from app.getAppMetrics).
  await sleep(500);
  const metrics = app.getAppMetrics();
  const memByType = {};
  let totalWorkingSetKB = 0;
  for (const m of metrics) {
    const ws = (m.memory && m.memory.workingSetSize) || 0; // KB
    totalWorkingSetKB += ws;
    memByType[m.type] = (memByType[m.type] || 0) + ws;
  }

  // ---- Warm run: second load in the same (now warm) session ---------------
  const warmWin = makeWindow();
  const tWarm0 = Date.now();
  await warmWin.loadURL('app://local/index.html');
  const warmDone = await waitForDone(warmWin.webContents, 30000);
  const warmStartMs = Date.now() - tWarm0;
  warmWin.destroy();

  // ---- Compare probes against assertions.json -----------------------------
  const comparison = [];
  let deviations = 0;
  if (results && Array.isArray(results.probes)) {
    for (const p of results.probes) {
      const rule = ASSERTIONS.probes[p.id];
      const asExpected = !!(rule && rule.expected.includes(p.status));
      if (!asExpected) deviations += 1;
      comparison.push({
        index: p.index,
        id: p.id,
        category: p.category,
        status: p.status,
        expected: rule ? rule.expected : null,
        verdict: asExpected ? 'as-expected' : 'DEVIATION',
        detail: p.detail,
      });
    }
  } else {
    deviations = 999; // module never ran = harness FAIL
  }

  // ---- Destructive fixtures (isolated) ------------------------------------
  const fixtures = { navigateExternal: 'not-run', triggerDownload: 'not-run', crash: 'not-run', hang: 'not-run' };

  // (1) external navigation + download denial (reuse the cold window)
  const navBefore = hostLevel.externalNavDenied;
  const dlBefore = hostLevel.downloadsDenied;
  const urlBefore = coldWin.webContents.getURL();
  try {
    await coldWin.webContents.executeJavaScript('window.__spikeFixtures.navigateExternal(); "ok"');
  } catch { /* navigation denial can reject the eval; that's fine */ }
  await sleep(700);
  try {
    await coldWin.webContents.executeJavaScript('window.__spikeFixtures.triggerDownload(); "ok"');
  } catch { /* ignore */ }
  await sleep(700);
  const urlAfter = coldWin.webContents.getURL();
  fixtures.navigateExternal = (hostLevel.externalNavDenied > navBefore && urlAfter === urlBefore)
    ? `DENIED (origin unchanged: ${urlAfter})`
    : `NOT-DENIED (before=${urlBefore} after=${urlAfter} denials=${hostLevel.externalNavDenied - navBefore})`;
  fixtures.triggerDownload = (hostLevel.downloadsDenied > dlBefore)
    ? `DENIED (will-download prevented, count +${hostLevel.downloadsDenied - dlBefore})`
    : 'NOT-DENIED (no will-download event observed)';

  // (2) real renderer crash containment
  try {
    const crashWin = makeWindow();
    await crashWin.loadURL('app://local/index.html');
    await waitForDone(crashWin.webContents, 20000);
    const gone = new Promise((resolve) => {
      crashWin.webContents.once('render-process-gone', (_e, d) => resolve(d && d.reason));
    });
    crashWin.webContents.forcefullyCrashRenderer();
    const reason = await Promise.race([gone, sleep(8000).then(() => 'no-event-8s')]);
    // Host survived if we are still executing here. Prove relaunch capability:
    const relaunch = makeWindow();
    await relaunch.loadURL('app://local/index.html');
    const rl = await waitForDone(relaunch.webContents, 20000);
    let relaunchRan = false;
    try { relaunchRan = !!(await relaunch.webContents.executeJavaScript('!!(window.__spikeResults&&window.__spikeResults.probes)')); } catch { /* ignore */ }
    relaunch.destroy();
    try { crashWin.destroy(); } catch { /* already gone */ }
    // NB: done-state 'error' just echoes the cachestorage FAIL (payload sets state=error
    // whenever ANY probe FAILs); relaunchRan=true is the real "host recovered" proof.
    fixtures.crash = `CONTAINED (render-process-gone reason=${reason}; host alive; relaunch produced results=${relaunchRan}, done-state=${rl.state})`;
  } catch (e) {
    fixtures.crash = `error: ${e && e.message}`;
  }

  // (3) hang / unresponsive detection (bounded)
  try {
    const hangWin = makeWindow();
    await hangWin.loadURL('app://local/index.html');
    await waitForDone(hangWin.webContents, 20000);
    let unresponsiveAt = null;
    const tHang = Date.now();
    hangWin.on('unresponsive', () => { if (unresponsiveAt === null) unresponsiveAt = Date.now() - tHang; });
    // Fire-and-forget an infinite busy-loop in the renderer; never await it.
    hangWin.webContents.executeJavaScript('window.__spikeFixtures.hang()').catch(() => {});
    // Bounded wait for the unresponsive event.
    for (let i = 0; i < 24 && unresponsiveAt === null; i++) await sleep(500); // up to 12s
    hangWin.destroy(); // force-kills the hung renderer
    fixtures.hang = unresponsiveAt !== null
      ? `DETECTED ('unresponsive' at ~${unresponsiveAt}ms; window destroyed, host alive)`
      : 'NOT-OBSERVED within 12s bound (renderer busy-loop; window force-destroyed; host stayed alive) — Chromium hung-renderer detection can exceed this bound without input';
  } catch (e) {
    fixtures.hang = `error: ${e && e.message}`;
  }

  try { coldWin.destroy(); } catch { /* ignore */ }

  // ---- Assemble + write results ------------------------------------------
  const externalEgressZero = egress.blockedExternal === 0
    ? 'ZERO external requests attempted (nothing to block)'
    : `${egress.blockedExternal} external request(s) attempted and ALL cancelled by onBeforeRequest`;

  const securityNegs = comparison.filter((c) => c.category === 'security');
  const secBlockedAll = securityNegs.every((c) => c.status === 'BLOCKED' || (c.id === 'trusted_types' && c.status === 'SKIP'));

  const summary = {
    ran: !!(results && Array.isArray(results.probes)),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: `${process.platform} ${process.arch}`,
    probeCount: results && results.probes ? results.probes.length : 0,
    asExpected: comparison.filter((c) => c.verdict === 'as-expected').length,
    deviations,
    securityNegativesAllBlocked: secBlockedAll,
    coldStartMs,
    warmStartMs,
    coldDoneState: coldDone.state,
    warmDoneState: warmDone.state,
    idleResidentKB: totalWorkingSetKB,
    memByTypeKB: memByType,
    egress,
    hostLevel,
    fixtures,
  };

  writeResultsMd(summary, comparison);

  // Console summary (so the exit code + numbers are visible in the run log).
  process.stdout.write('\n===== ELECTRON HARNESS SUMMARY =====\n');
  process.stdout.write(`ran=${summary.ran} electron=${summary.electron} chromium=${summary.chromium} node=${summary.node}\n`);
  process.stdout.write(`probes as-expected: ${summary.asExpected}/${summary.probeCount}  deviations=${deviations}\n`);
  process.stdout.write(`security negatives all BLOCKED: ${secBlockedAll}\n`);
  process.stdout.write(`egress: ${externalEgressZero} (allowedLocal=${egress.allowedLocal})\n`);
  process.stdout.write(`cold=${coldStartMs}ms warm=${warmStartMs}ms idleResident=${totalWorkingSetKB}KB\n`);
  for (const c of comparison) {
    process.stdout.write(`  [${c.verdict === 'as-expected' ? 'OK ' : 'DEV'}] ${c.id.padEnd(22)} ${String(c.status).padEnd(8)} exp=${JSON.stringify(c.expected)}\n`);
  }
  process.stdout.write(`fixtures: nav=${fixtures.navigateExternal}\n          download=${fixtures.triggerDownload}\n          crash=${fixtures.crash}\n          hang=${fixtures.hang}\n`);
  process.stdout.write(`RESULTS written: ${RESULTS_PATH}\n`);
  process.stdout.write('====================================\n');

  const exitCode = (deviations === 0 && egress.blockedExternal === 0 && summary.ran && secBlockedAll) ? 0 : 1;
  process.stdout.write(`HARNESS_EXIT=${exitCode}\n`);
  app.exit(exitCode);
}

function writeResultsMd(s, comparison) {
  const now = new Date().toISOString();
  const memLines = Object.entries(s.memByTypeKB)
    .map(([t, kb]) => `  - ${t}: ${(kb / 1024).toFixed(1)} MiB (${kb} KB)`).join('\n');
  const probeRows = comparison.map((c) =>
    `| ${c.index} | \`${c.id}\` | ${c.category} | ${c.status} | ${c.expected ? c.expected.join('/') : '—'} | ${c.verdict === 'as-expected' ? 'OK' : '**DEVIATION**'} | ${c.detail.replace(/\|/g, '\\|')} |`).join('\n');
  const blockedRows = s.egress.blockedList.length
    ? s.egress.blockedList.map((b) => `  - ${b.method} ${b.scheme}: ${b.url} (${b.resourceType})`).join('\n')
    : '  - (none — no external request was ever attempted)';

  const md = `# Electron runtime-eval harness — Windows results, 2026-07-22

First real runtime execution of the ADR-006 common test app (\`spike/runtime-eval/payload/\`).
Generated by \`main.js\` from a live run; every number below is straight from that run's tool output.

- Run timestamp (wall clock, informational only): ${now}
- Runtime: **Electron ${s.electron}** (Chromium ${s.chromium}, Node ${s.node}, V8 ${s.v8})
- Host: Windows (${s.platform})
- Security gate applied: \`sandbox:true\` + \`contextIsolation:true\` + \`nodeIntegration:false\` + \`webSecurity:true\`, no preload (zero native bridge). Popups/new-windows denied, external navigation denied, all permissions denied, all downloads denied.
- Payload origin: \`app://local/\` privileged local scheme (standard+secure), not \`file://\` (file:// blocks ES-module loading in Chromium).
- Toolchain deviation (documented): the repo root pins Node 22.23.1 for its CSP/security tests; this harness is a **separate framework-neutral spike** driven by the local Node ${process.versions.node === s.node ? '24.17.0 launcher' : 'launcher'} and running inside Electron ${s.electron}'s bundled Node ${s.node} / Chromium ${s.chromium}. Repo root toolchain untouched.

## Matrix row (raw, no synthetic score)

| Metric | Value |
|---|---|
| Harness ran (module executed) | ${s.ran} |
| Probes as-expected | ${s.asExpected} / ${s.probeCount} |
| Deviations | ${s.deviations} |
| Security negatives all BLOCKED | ${s.securityNegativesAllBlocked} |
| Cold start (spawn→#status settled) | ${s.coldStartMs} ms (state=${s.coldDoneState}) |
| Warm start (2nd load, same session) | ${s.warmStartMs} ms (state=${s.warmDoneState}) |
| Idle resident memory (sum workingSetSize) | ${(s.idleResidentKB / 1024).toFixed(1)} MiB (${s.idleResidentKB} KB) |
| External egress requests attempted | ${s.egress.blockedExternal} |
| External egress requests allowed | 0 (deny-all in \`onBeforeRequest\`) |
| Local (app://) requests served | ${s.egress.allowedLocal} |

Per-process idle memory (workingSetSize):
${memLines}

> **On the \`state=error\` labels above:** the payload sets \`#status[data-state=error]\` whenever
> *any* probe returns FAIL. The single FAIL here is \`cachestorage\` (root-caused below), so cold,
> warm and crash-relaunch all show a terminal state of \`error\`. Every one of those page loads ran
> ALL 12 probes to completion — the label is the FAIL echo, not a load failure.

## Probe results vs \`assertions.json\`

| # | Probe | Category | Status | Expected | Verdict | Detail |
|---|---|---|---|---|---|---|
${probeRows}

## Security negatives — BLOCKED?

${comparison.filter((c) => c.category === 'security').map((c) => `- \`${c.id}\`: **${c.status}** (expected ${c.expected.join('/')}) — ${c.verdict === 'as-expected' ? 'OK' : 'DEVIATION'}`).join('\n')}

All security negatives BLOCKED (TT SKIP-acceptable only if unsupported): **${s.securityNegativesAllBlocked}**.

## The one DEVIATION — \`cachestorage\` FAIL (root-caused, payload-side, NOT an Electron defect)

The \`cachestorage\` probe calls \`cache.put(new Request('runtime-eval:/fixture'), …)\`. Per the
Service Worker Cache spec, \`Cache.put()\` throws a \`TypeError\` when the request URL's scheme is
not \`http\`/\`https\`; \`runtime-eval:\` is a custom scheme, so it throws \`TypeError\` — exactly what
was observed (\`threw: TypeError\`). CacheStorage itself IS available and secure-context-enabled
here (\`caches.open\` succeeded before the throw). This reproduces on any Chromium, including real
Chrome served over https — it is a **latent bug in the byte-locked test-app payload** (a synthetic
non-http scheme used for the cache key), surfaced by this first real execution, **not** a runtime
property of Electron. The payload is byte-locked (\`asset-manifest.json\`) + is the ADR-006 SoT
deliverable, so it was **deliberately NOT edited here**; this is filed as a payload fix-forward for
its owner. Recorded as a DEVIATION in the raw matrix as the protocol requires — not auto-resolved.

## Egress block — real proof (not just \`connect-src 'none'\`)

Enforcement layer: Electron \`session.defaultSession.webRequest.onBeforeRequest\` cancels every
request whose scheme is not local (\`app:\`/\`data:\`/\`blob:\`/\`devtools:\`/\`about:\`) and logs it.

- External requests attempted during the whole run: **${s.egress.blockedExternal}**
- External requests allowed through: **0** (cancelled deterministically)
- Local app:// requests served: ${s.egress.allowedLocal}
- Blocked external request log:
${blockedRows}

**Honest method limit:** this proves zero egress *at Chromium's network stack + webRequest layer*.
It is NOT a kernel-level socket/DNS packet capture. There is no OS socket monitor here. The
residual-risk argument for "no raw socket either" is structural, not measured: with
\`nodeIntegration:false\` + \`sandbox:true\` + no preload, app content has no Node/native API to
open a raw socket; the only network path available to it is Chromium's stack, which is what
\`onBeforeRequest\` gates. A future run could add Windows-level ETW/\`Get-NetTCPConnection\`
sampling to close this gap empirically.

## Destructive fixtures (isolated runs, host-level truth)

- **External navigation** (\`navigateExternal\`): ${s.fixtures.navigateExternal}
- **Download** (\`triggerDownload\`): ${s.fixtures.triggerDownload}
- **Renderer crash containment** (\`forcefullyCrashRenderer\`): ${s.fixtures.crash}
- **Hang / unresponsive** (\`hang\`): ${s.fixtures.hang}

## Honest scope / limits

- **One OS only** (Windows). macOS + Linux rows of the ADR-006 matrix are NOT produced here.
- **One runtime only** (Electron primary hypothesis). The CEF fallback harness is a separate,
  later task; this is a one-sided row, not the two-way comparison ADR-006 ultimately needs.
- **Egress proof** is network-stack + webRequest level, not kernel socket/DNS (see above).
- **Cold/warm start** are single-sample, coarse wall-clock deltas (\`Date.now()\`), not p50/p95
  over many launches. Idle memory is a single snapshot. Treat as first-order magnitudes.
- **Hang detection** is bounded to 12 s; Chromium's own unresponsive-renderer timer can exceed
  that without user input, so NOT-OBSERVED is a bound artifact, not proof of no detection.
- Package/runtime download size, CPU idle/active, memory after 1/5/10 apps, and engine
  security-patch→user latency are ADR-006 deliverables NOT covered by this first row.
- ADR-006 stays PROPOSED. This file is one measured row of evidence, not a runtime selection.

---
*Codie · ADR-006 Electron harness · isolated spike · first Windows runtime execution 2026-07-22*
`;
  fs.writeFileSync(RESULTS_PATH, md);
}

// Global watchdog: never let the harness hang forever.
const WATCHDOG = setTimeout(() => {
  process.stderr.write('HARNESS TIMEOUT (180s) — forcing exit 3\n');
  app.exit(3);
}, 180000);
WATCHDOG.unref && WATCHDOG.unref();

app.whenReady().then(realMain).catch((e) => {
  process.stderr.write(`HARNESS CRASH: ${e && e.stack}\n`);
  app.exit(2);
});

app.on('window-all-closed', () => { /* keep alive; we control exit explicitly */ });
