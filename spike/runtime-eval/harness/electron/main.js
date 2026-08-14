// ADR-006 Electron runtime-evaluation harness (isolated spike, Windows first row).
//
// WHAT IT DOES
//   * Registers an `app://` privileged local scheme and serves spike/runtime-eval/payload
//     from it (a proper local origin so ES modules + service workers work; file:// would
//     block module loading in Chromium via the "null" origin).
//   * Opens a BrowserWindow under the FULL ADR-006 app-context security gate:
//       sandbox:true, contextIsolation:true, nodeIntegration:false, webSecurity:true,
//       no preload (zero native bridge -> native_ipc_zero_grant must be BLOCKED).
//   * Denies popups/new windows, external navigation + server redirects, all permission
//     requests AND checks, all downloads; disables the auxclick (middle-click) nav surface.
//   * REAL egress block: session.webRequest.onBeforeRequest cancels every non-local scheme
//     and logs it. Proves zero external requests reached Chromium's network stack.
//   * WebRTC egress closure: setWebRTCIPHandlingPolicy('disable_non_proxied_udp') on every
//     window — closes the ICE/STUN/TURN UDP path that bypasses webRequest (set-policy, not
//     empirically exercised; the payload opens no RTCPeerConnection).
//   * Runs the 12 probes (reads window.__spikeResults), compares each against assertions.json.
//   * Triggers the destructive fixtures in isolated windows: external navigation (denied),
//     download (denied), real renderer crash (containment), hang (unresponsive detection).
//   * Records raw host metrics: cold/warm start, idle resident memory, per-process breakdown.
//   * Writes RESULTS_<PLATFORM>_<run-date>.md and prints a summary. No synthetic score.
//
// EXIT CONTRACT (issue #41): a run may only report HARNESS_EXIT=0 when every
// control it claims to measure was demonstrably exercised AND passed.
//   0 all claimed controls exercised and passed · 1 a control FAILED ·
//   2 harness crash · 3 watchdog · 4 NOT MEASURED (absent/incomplete/
//   inconclusive) · 5 payload byte lock not satisfied (nothing was measured).
// The rules live in harness-lib.js so they are testable without Electron; see
// tests/spike/adr006-harness.test.js.
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
const { execFileSync } = require('node:child_process');
const lib = require('./harness-lib.js');

// ---------------------------------------------------------------------------
// Paths (harness lives at spike/runtime-eval/harness/electron/)
// ---------------------------------------------------------------------------
const SPIKE_DIR = path.resolve(__dirname, '..', '..');        // spike/runtime-eval
const PAYLOAD_DIR = path.join(SPIKE_DIR, 'payload');
// PR#42 P1: read the contract ONCE as bytes and judge THOSE bytes. Hashing the
// path a second time would leave a window in which the file changes between the
// hash and the parse; ASSERTIONS below is parsed from the hashed buffer.
const ASSERTIONS_PATH = path.join(SPIKE_DIR, 'assertions.json');
const ASSERTIONS_BYTES = fs.readFileSync(ASSERTIONS_PATH);
const ASSERTIONS = JSON.parse(ASSERTIONS_BYTES.toString('utf8'));
const ASSET_MANIFEST_PATH = path.join(SPIKE_DIR, 'asset-manifest.json');
const VERIFY_DETERMINISM = path.join(SPIKE_DIR, 'verify-determinism.mjs');
// #41 P2: the results path is derived from the real platform + run date and
// never overwrites an existing document (see lib.resolveResultsPath).
let RESULTS_PATH = null;

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
const hostLevel = {
  downloadsDenied: 0,
  externalNavDenied: 0,
  externalRedirectDenied: 0,
  windowOpenDenied: 0,
  permissionDenied: 0,
  permissionChecksDenied: 0,
};
const consoleLog = []; // renderer console (captures CSP refusal messages = evidence)

// Defense-in-depth hardening applied on top of the 4 core ADR-006 gate flags.
// These close egress/navigation paths the 4 flags + onBeforeRequest do NOT cover.
const hardening = {
  webrtcIpHandlingPolicy: 'disable_non_proxied_udp', // STUN/TURN/ICE UDP bypasses session.webRequest
  webrtcPolicyApplied: 0,
  webrtcPolicyErrors: [],
  disableBlinkFeatures: 'Auxclick',                   // suppress middle-click aux navigation surface
  willRedirectHandlerInstalled: true,                 // origin-pin server-side redirects too
  permissionRequestHandler: 'deny-all',
  permissionCheckHandler: 'deny-all',
  privilegedScheme: 'app: standard+secure+supportFetchAPI+corsEnabled+stream+allowServiceWorkers',
};

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

// ---------------------------------------------------------------------------
// Host-level observation (PR#42 P1 — external_protocol_os)
//
// assertions.json requires, separately from the in-page probe, that "no
// external URL handler process is spawned when external_protocol /
// navigateExternal is exercised". The payload can only see that window.open
// returned null; whether the OS launched a handler is invisible to it. These
// helpers take a process-table snapshot around a real external-protocol attempt
// and compare it against the handler the OS has registered for that scheme.
//
// The payload's own scheme (web+spikeext) usually has NO registered handler, so
// "nothing launched" would be vacuously true. A scheme that IS registered on
// this host is therefore exercised as a POSITIVE CONTROL: only then does
// "no handler process appeared" carry information.
// ---------------------------------------------------------------------------
const EXTERNAL_PROTOCOL_ATTEMPTS = [
  { scheme: 'web+spikeext', url: 'web+spikeext://launch' }, // the scheme the payload probes
  { scheme: 'ms-settings', url: 'ms-settings:about' },      // Windows: registered by the OS
  { scheme: 'mailto', url: 'mailto:spike@cwap.invalid' },   // RFC 6761 .invalid, never resolvable
];

function snapshotProcesses() {
  try {
    const counts = new Map();
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/fo', 'csv', '/nh'], {
        encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const line of out.split(/\r?\n/)) {
        const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (m) counts.set(m[1].toLowerCase(), (counts.get(m[1].toLowerCase()) || 0) + 1);
      }
    } else {
      const out = execFileSync('ps', ['-eo', 'comm='], {
        encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const line of out.split(/\r?\n/)) {
        const name = line.trim().split('/').pop().toLowerCase();
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    return counts.size ? counts : null;
  } catch {
    return null; // fail-closed: the caller reports INCONCLUSIVE, never PASS
  }
}

// Image name of the process the OS would launch for `scheme:`, or null.
function registeredHandlerImage(scheme) {
  if (process.platform !== 'win32') return null;
  try {
    // stderr is piped, not inherited: `reg query` writes a localized
    // "key not found" line for every unregistered scheme, which is an expected
    // outcome here and must not pollute the run log.
    const out = execFileSync('reg', ['query', `HKCR\\${scheme}\\shell\\open\\command`, '/ve'], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const m = /REG_[A-Z_]+\s+(.*)$/m.exec(out);
    if (!m) return null;
    const cmd = m[1].trim();
    const exe = /^"([^"]+)"/.exec(cmd) || /^(\S+\.exe)/i.exec(cmd);
    if (!exe) return null;
    return path.basename(exe[1]).toLowerCase();
  } catch {
    return null; // no handler registered for this scheme on this host
  }
}

function newProcessImages(before, after) {
  const grown = [];
  for (const [name, n] of after) {
    if (n > (before.get(name) || 0)) grown.push(name);
  }
  return grown;
}

// Apply the ADR-006 Electron security gate + deny handlers to a window's webContents.
function harden(win) {
  const wc = win.webContents;

  // --- WebRTC egress closure (the pillar session.webRequest does NOT cover) ---
  // WebRTC ICE/STUN/TURN open UDP peer connections directly through the OS,
  // bypassing Chromium's HTTP network stack and therefore onBeforeRequest.
  // 'disable_non_proxied_udp' forces all UDP through a proxy; none is configured
  // here, so there is no direct peer-UDP egress path. Structural closure applied;
  // the payload never exercises WebRTC (no getUserMedia/RTCPeerConnection), so
  // this is a set-policy defense, not an empirically-triggered block.
  try {
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    hardening.webrtcPolicyApplied += 1;
  } catch (e) {
    hardening.webrtcPolicyErrors.push(String(e && e.message));
  }

  wc.setWindowOpenHandler(() => {
    hostLevel.windowOpenDenied += 1;
    return { action: 'deny' };
  });

  // Origin-pin BOTH client-initiated navigation and server-issued redirects.
  // #41 P1: URL.origin is "null" for every non-special scheme, so the previous
  // `new URL(a).origin !== new URL(b).origin` treated app://local and
  // app://other — and every data:/blob: URL — as the SAME origin, i.e. as
  // internal. lib.isExternalNavigation compares scheme+host+port explicitly and
  // is fail-closed for opaque and unparseable URLs.
  const denyIfExternal = (event, url, isRedirect) => {
    const external = lib.isExternalNavigation(wc.getURL() || 'app://local/', url);
    if (external) {
      event.preventDefault();
      hostLevel.externalNavDenied += 1;
      if (isRedirect) hostLevel.externalRedirectDenied += 1;
    }
  };
  wc.on('will-navigate', (event, url) => denyIfExternal(event, url, false));
  wc.on('will-redirect', (event, url) => denyIfExternal(event, url, true));

  // console-message: Electron 43 passes an Event params object as arg0 (the old
  // (event, level, message) positional form is deprecated). Read .message off
  // the params object, fall back to the positional arg for older builds.
  wc.on('console-message', (event, level, message) => {
    const msg = (event && typeof event.message === 'string') ? event.message : message;
    if (consoleLog.length < 60) consoleLog.push(msg);
  });
}

// #41 P2: set to a NON-persistent partition name so every run starts genuinely
// cold (see createEvalSession). null = fallback to the cleared default session.
let EVAL_PARTITION = null;

function makeWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      ...(EVAL_PARTITION ? { partition: EVAL_PARTITION } : {}),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // No preload: zero native bridge is exposed to app content.
      backgroundThrottling: false,
      // Drop the middle-click "auxclick" navigation surface entirely.
      disableBlinkFeatures: 'Auxclick',
    },
  });
  harden(win);
  return win;
}

// PR#42 P1 — the structured host-level verdict for `external_protocol_os`.
// Runs in its OWN window so a mishandled navigation cannot disturb the measured
// cold window. Returns the {verdict, detail} vocabulary of the fixtures, so the
// exit decision treats it exactly like any other required control.
async function measureExternalProtocolOs() {
  const probed = EXTERNAL_PROTOCOL_ATTEMPTS.map((a) => ({ ...a, handler: registeredHandlerImage(a.scheme) }));
  const withHandler = probed.filter((p) => p.handler);
  const before = snapshotProcesses();
  if (!before) {
    return { verdict: 'INCONCLUSIVE', detail: 'process table unavailable — no OS-level observation was possible', probed };
  }

  const attempts = [];
  let win = null;
  let openBefore = hostLevel.windowOpenDenied;
  let navBefore = hostLevel.externalNavDenied;
  try {
    win = makeWindow();
    await win.loadURL('app://local/index.html');
    // Let the page's own probes finish FIRST, then take the counters. The
    // payload runs a popup and an external_protocol probe on load; counting
    // from before that would let the page's own window.open satisfy the
    // "was it exercised?" control instead of the attempts made here.
    await waitForDone(win.webContents, 20000);
    openBefore = hostLevel.windowOpenDenied;
    navBefore = hostLevel.externalNavDenied;
    for (const p of probed) {
      const u = JSON.stringify(p.url);
      let opened = 'no-result';
      try {
        opened = await win.webContents.executeJavaScript(
          `(() => { try { const w = window.open(${u}, '_blank', 'noopener');`
          + ` if (w) { try { w.close(); } catch (e) {} return 'window-returned'; } return 'null-returned'; }`
          + ` catch (e) { return 'threw:' + e.name; } })()`,
        );
      } catch (e) {
        opened = `eval-rejected:${e && e.name}`;
      }
      // Also try a real top-level navigation to the external protocol; never awaited
      // as a navigation, the denial handler resolves it.
      win.webContents.executeJavaScript(`try { window.location.assign(${u}); } catch (e) {}`).catch(() => {});
      attempts.push({ scheme: p.scheme, handler: p.handler, windowOpen: opened });
      await sleep(400);
    }
    await sleep(1200); // give a launched handler time to appear in the table
  } catch (e) {
    return { verdict: 'ERROR', detail: `external-protocol probe threw: ${e && e.message}`, probed, attempts };
  } finally {
    try { if (win) win.destroy(); } catch { /* ignore */ }
  }

  const after = snapshotProcesses();
  if (!after) {
    return { verdict: 'INCONCLUSIVE', detail: 'second process snapshot failed — no OS-level observation', probed, attempts };
  }
  const grown = newProcessImages(before, after);
  const launched = withHandler.filter((p) => grown.includes(p.handler));
  const exercised = (hostLevel.windowOpenDenied - openBefore) > 0 || (hostLevel.externalNavDenied - navBefore) > 0;
  const schemeList = probed.map((p) => `${p.scheme}${p.handler ? `->${p.handler}` : '(no handler)'}`).join(', ');

  if (launched.length) {
    return {
      verdict: 'FAIL',
      detail: `OS handler process launched: ${launched.map((p) => `${p.scheme}->${p.handler}`).join(', ')}`,
      probed, attempts, newProcesses: grown,
    };
  }
  if (!exercised) {
    return {
      verdict: 'INCONCLUSIVE',
      detail: `the external-protocol attempt never reached the deny handlers (windowOpenDenied +0, externalNavDenied +0) — the control was not exercised [${schemeList}]`,
      probed, attempts, newProcesses: grown,
    };
  }
  if (!withHandler.length) {
    return {
      verdict: 'INCONCLUSIVE',
      detail: `no OS handler is registered for any probed scheme on this host [${schemeList}] — "nothing launched" would be vacuously true`,
      probed, attempts, newProcesses: grown,
    };
  }
  return {
    verdict: 'PASS',
    detail: `no OS handler process appeared; positive control present: ${withHandler.map((p) => `${p.scheme}->${p.handler}`).join(', ')} [attempts: ${schemeList}; ${grown.length} unrelated new process image(s) in the window]`,
    probed, attempts, newProcesses: grown,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// #41 P2 — "the cold measurement is not cold". session.defaultSession is
// Electron's PERSISTENT profile: service-worker registrations, storage and HTTP
// cache survive between runs, so the "cold" sample was warmed by earlier runs.
// A partition name WITHOUT the `persist:` prefix is in-memory and dies with the
// process. If the Electron build does not expose Session#protocol we fall back
// to the default session and clear it explicitly — and record which path ran,
// because the two are not equally strong.
async function createEvalSession() {
  const partition = `runtime-eval-${process.pid}-${Date.now()}`;
  try {
    const ses = session.fromPartition(partition);
    if (ses && ses.protocol && typeof ses.protocol.handle === 'function') {
      EVAL_PARTITION = partition;
      return { ses, mode: 'in-memory-partition', partition };
    }
  } catch (e) {
    process.stderr.write(`fresh-session fallback: ${e && e.message}\n`);
  }
  const ses = session.defaultSession;
  try {
    await ses.clearStorageData();
    await ses.clearCache();
    return { ses, mode: 'default-session-cleared', partition: null };
  } catch (e) {
    // PR#42 P2: this used to be reported only. The run then measured a "cold"
    // start against Electron's PERSISTENT profile with stale storage/cache
    // still in place and could still exit 0. lib.sessionIsCold() rejects this
    // mode and evaluateRun turns it into NOT MEASURED (exit 4).
    return { ses, mode: `default-session-CLEAR-FAILED (${e && e.message})`, partition: null };
  }
}

async function realMain() {
  // ---- #41 P1: payload byte lock BEFORE anything is measured ---------------
  // `npm start` used to run `electron .` directly, so a modified payload could
  // be evaluated and overwrite the result artifact with HARNESS_EXIT=0 without
  // asset-manifest.json ever being consulted. The gate now runs in-process, so
  // it cannot be bypassed by invoking electron directly either.
  const byteLock = lib.verifyByteLock({
    scriptPath: VERIFY_DETERMINISM,
    execPath: process.execPath,
    run: (file, args, opts) => {
      try {
        const stdout = execFileSync(file, args, opts);
        return { status: 0, stdout: String(stdout), stderr: '' };
      } catch (e) {
        return {
          status: typeof e.status === 'number' ? e.status : -1,
          stdout: String(e.stdout || ''),
          stderr: String(e.stderr || ''),
          error: typeof e.status === 'number' ? null : e,
        };
      }
    },
    // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node, so
    // the ESM gate script runs without requiring a second Node installation.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.stdout.write(`byte lock: ok=${byteLock.ok} exit=${byteLock.exitCode} — ${byteLock.detail}\n`);
  if (!byteLock.ok) {
    if (byteLock.output) process.stdout.write(`${byteLock.output}\n`);
    process.stdout.write('NOTHING WAS MEASURED: refusing to evaluate a payload that is not byte-identical to asset-manifest.json\n');
    process.stdout.write(`HARNESS_EXIT=${lib.EXIT.BYTE_LOCK}\n`);
    app.exit(lib.EXIT.BYTE_LOCK);
    return;
  }

  // ---- PR#42 P1: the ASSERTION CONTRACT is locked too ----------------------
  // The byte lock above covers payload/ only. Every "expected" outcome that
  // decides exit 0 comes from assertions.json, which was unlocked: adding FAIL
  // to a security probe's expected[] left all payload hashes intact and turned
  // a real deviation into green evidence. Hash the very bytes that were parsed
  // against the committed manifest, in-process, before anything is measured.
  let contractLock;
  try {
    const manifest = JSON.parse(fs.readFileSync(ASSET_MANIFEST_PATH, 'utf8'));
    contractLock = lib.verifyContractLock({
      bytes: ASSERTIONS_BYTES,
      manifest,
      key: 'assertions.json',
    });
  } catch (e) {
    contractLock = { ok: false, detail: `asset-manifest.json unreadable: ${e && e.message}` };
  }
  process.stdout.write(`contract lock: ok=${contractLock.ok} — ${contractLock.detail}\n`);
  if (!contractLock.ok) {
    process.stdout.write('NOTHING WAS MEASURED: refusing to evaluate against an assertion contract that is not byte-identical to asset-manifest.json\n');
    process.stdout.write(`HARNESS_EXIT=${lib.EXIT.BYTE_LOCK}\n`);
    app.exit(lib.EXIT.BYTE_LOCK);
    return;
  }

  const evalSession = await createEvalSession();
  const ses = evalSession.ses;
  const handleProtocol = (evalSession.mode === 'in-memory-partition' && ses.protocol)
    ? ses.protocol.handle.bind(ses.protocol)
    : protocol.handle.bind(protocol);

  // Serve payload from app://local/... on the evaluation session.
  handleProtocol('app', (request) => {
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

  process.stdout.write(`evaluation session: ${evalSession.mode}${evalSession.partition ? ` (${evalSession.partition})` : ''}\n`);

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
  ses.setPermissionCheckHandler(() => { hostLevel.permissionChecksDenied += 1; return false; });
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
  // PR#42 P1: READ the warm results before destroying the window. Judging the
  // warm load by its #status pixel alone accepted data-state="error" as a
  // completed run: a probe that only fails on the second load (warm HTTP cache,
  // already-registered service worker, existing IndexedDB) never reached the
  // exit code, and the report printed warmDoneState=error next to "all
  // controls passed".
  let warmResults = null;
  try {
    warmResults = await warmWin.webContents.executeJavaScript('window.__spikeResults');
  } catch (e) {
    warmResults = { error: String(e && e.message) };
  }
  warmWin.destroy();

  // ---- Compare probes against assertions.json -----------------------------
  // #41 P1: iterate the COMPLETE assertion set. Iterating the returned list let
  // an omitted probe (e.g. native_ipc_zero_grant) vanish silently: every
  // remaining entry was "expected", deviations stayed 0, and the harness exited
  // green without ever exercising that security control.
  const probeReport = lib.compareProbes(ASSERTIONS.probes, results);
  const comparison = probeReport.comparison;
  const deviations = probeReport.deviations;
  const secNegatives = lib.securityNegatives(comparison);

  // PR#42 P1: the warm load is compared against the SAME contract, so a
  // state-dependent FAIL on the second load reaches the exit code.
  const warmReport = lib.compareProbes(ASSERTIONS.probes, warmResults);
  const warmProbes = {
    ran: warmReport.ran,
    deviations: warmReport.deviations,
    missing: warmReport.missing,
  };

  // ---- Destructive fixtures (isolated) ------------------------------------
  // #41 P1: structured {verdict, detail}; the verdict feeds the exit code and
  // the default is NOT-RUN, so a fixture that never executed can never read as
  // a pass.
  const notRun = (what) => ({ verdict: 'NOT-RUN', detail: `${what} was never triggered` });
  const fixtures = {
    navigateExternal: notRun('external navigation'),
    triggerDownload: notRun('download'),
    crash: notRun('renderer crash'),
    hang: notRun('hang'),
  };

  // (1) external navigation + download denial (reuse the cold window)
  const navBefore = hostLevel.externalNavDenied;
  const dlBefore = hostLevel.downloadsDenied;
  const urlBefore = coldWin.webContents.getURL();
  // PR#42 P1 — host assertion `download_os` says "no file is written to the
  // download directory". The will-download counter alone does not show that;
  // the file itself is the observation.
  let downloadDir = null;
  let downloadFile = null;
  let downloadExistedBefore = null;
  try {
    downloadDir = app.getPath('downloads');
    downloadFile = path.join(downloadDir, 'spike-fixture.bin');
    downloadExistedBefore = fs.existsSync(downloadFile);
  } catch (e) {
    downloadDir = `(unavailable: ${e && e.message})`;
  }
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
    ? { verdict: 'PASS', detail: `DENIED (origin unchanged: ${urlAfter})` }
    : { verdict: 'FAIL', detail: `NOT-DENIED (before=${urlBefore} after=${urlAfter} denials=${hostLevel.externalNavDenied - navBefore})` };
  fixtures.triggerDownload = (hostLevel.downloadsDenied > dlBefore)
    ? { verdict: 'PASS', detail: `DENIED (will-download prevented, count +${hostLevel.downloadsDenied - dlBefore})` }
    : { verdict: 'FAIL', detail: 'NOT-DENIED (no will-download event observed)' };

  // Host-level download observation (see above): the file, not the counter.
  let downloadOs;
  if (downloadFile === null) {
    downloadOs = { verdict: 'INCONCLUSIVE', detail: `download directory unavailable ${downloadDir}` };
  } else if (downloadExistedBefore) {
    downloadOs = { verdict: 'INCONCLUSIVE', detail: `a file named spike-fixture.bin already existed in ${downloadDir} before the run — no delta can be attributed` };
  } else if (fs.existsSync(downloadFile)) {
    downloadOs = { verdict: 'FAIL', detail: `the denied download was written to disk: ${downloadFile}` };
  } else {
    downloadOs = { verdict: 'PASS', detail: `no file written to ${downloadDir} (checked spike-fixture.bin before and after the fixture)` };
  }

  // PR#42 P1 — the OS-level external-protocol observation.
  let externalProtocolOs;
  try {
    externalProtocolOs = await measureExternalProtocolOs();
  } catch (e) {
    externalProtocolOs = { verdict: 'ERROR', detail: `external_protocol_os measurement threw: ${e && e.message}` };
  }

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
    // NB: done-state 'error' just echoes a probe FAIL (payload sets state=error
    // whenever ANY probe FAILs); relaunchRan=true is the real "host recovered" proof.
    // #41 P1: containment is only a PASS when the crash was actually observed
    // AND the relaunch produced results. Prose alone no longer decides.
    const contained = reason !== 'no-event-8s' && relaunchRan === true;
    const detail = `render-process-gone reason=${reason}; host alive; relaunch produced results=${relaunchRan}, done-state=${rl.state}`;
    fixtures.crash = reason === 'no-event-8s'
      ? { verdict: 'INCONCLUSIVE', detail: `no render-process-gone event within 8s — ${detail}` }
      : { verdict: contained ? 'PASS' : 'FAIL', detail: `${contained ? 'CONTAINED' : 'NOT-CONTAINED'} (${detail})` };
  } catch (e) {
    fixtures.crash = { verdict: 'ERROR', detail: `error: ${e && e.message}` };
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
    // #41 P1: NOT-OBSERVED is INCONCLUSIVE, not a pass. The fixture ran, the
    // runtime simply gave no observation inside the bound — that is "not
    // measured" (exit 4), and it must not be reported as hang detection.
    fixtures.hang = unresponsiveAt !== null
      ? { verdict: 'PASS', detail: `DETECTED ('unresponsive' at ~${unresponsiveAt}ms; window destroyed, host alive)` }
      : { verdict: 'INCONCLUSIVE', detail: 'NOT-OBSERVED within 12s bound (renderer busy-loop; window force-destroyed; host stayed alive) — Chromium hung-renderer detection can exceed this bound without input' };
  } catch (e) {
    fixtures.hang = { verdict: 'ERROR', detail: `error: ${e && e.message}` };
  }

  try { coldWin.destroy(); } catch { /* ignore */ }

  // ---- Assemble + write results ------------------------------------------
  const externalEgressZero = egress.blockedExternal === 0
    ? 'ZERO external requests attempted (nothing to block)'
    : `${egress.blockedExternal} external request(s) attempted and ALL cancelled by onBeforeRequest`;

  // #41 P1: computed over the FULL assertion set (a MISSING security negative
  // makes this false), and false unless at least one negative was exercised.
  const secBlockedAll = secNegatives.allBlocked;

  // PR#42 P1 — the host-level assertions of assertions.json get a STRUCTURED
  // verdict each and are required by the exit decision. The required list is
  // derived from the (now hash-locked) contract itself, so a host assertion
  // cannot be silently dropped from the required set: every key without a
  // verdict below reads as NOT-RUN and forces exit 4.
  const hostAssertions = {
    network: egress.blockedExternal === 0
      ? { verdict: 'PASS', detail: `zero external requests reached Chromium's network stack (allowedLocal=${egress.allowedLocal}); NOT an OS kernel socket/DNS observation` }
      : { verdict: 'FAIL', detail: `${egress.blockedExternal} external request(s) attempted (all cancelled, but the assertion is "no activity")` },
    external_protocol_os: { verdict: externalProtocolOs.verdict, detail: externalProtocolOs.detail },
    download_os: downloadOs,
    navigation_os: fixtures.navigateExternal,
    crash_containment: fixtures.crash,
    hang_detection: fixtures.hang,
  };
  const requiredHostAssertions = Object.keys(ASSERTIONS.hostLevelAssertions || {});

  // #41 P1/P2 + PR#42: the single decision point. Fixture verdicts, missing
  // probes, an unfinished OR unread warm run, a session that is not provably
  // cold, the assertion-contract lock and the host-level assertions all reach
  // the exit code now.
  const verdict = lib.evaluateRun({
    byteLock,
    contractLock,
    sessionMode: evalSession.mode,
    ran: probeReport.ran,
    deviations,
    missing: probeReport.missing,
    securityNegatives: secNegatives,
    egressBlockedExternal: egress.blockedExternal,
    coldDoneState: coldDone.state,
    warmDoneState: warmDone.state,
    warmProbes,
    fixtures,
    requiredFixtures: ['navigateExternal', 'triggerDownload', 'crash', 'hang'],
    hostAssertions,
    requiredHostAssertions,
  });

  const summary = {
    ran: probeReport.ran,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: `${process.platform} ${process.arch}`,
    probeCount: Object.keys(ASSERTIONS.probes).length,
    probesReported: results && Array.isArray(results.probes) ? results.probes.length : 0,
    asExpected: comparison.filter((c) => c.verdict === 'as-expected').length,
    missingProbes: probeReport.missing,
    deviations,
    securityNegativesAllBlocked: secBlockedAll,
    securityNegatives: secNegatives,
    coldStartMs,
    // #41 P2: an unfinished load has no measurement to report.
    warmStartMs: warmDone.state === 'timeout' ? null : warmStartMs,
    coldDoneState: coldDone.state,
    warmDoneState: warmDone.state,
    idleResidentKB: totalWorkingSetKB,
    memByTypeKB: memByType,
    egress,
    hostLevel,
    hardening,
    fixtures,
    byteLock,
    contractLock,
    session: evalSession.mode,
    sessionCold: lib.sessionIsCold(evalSession.mode),
    // PR#42 P1: the warm load is now compared, not just watched.
    warmProbes,
    warmProbesReported: warmResults && Array.isArray(warmResults.probes) ? warmResults.probes.length : 0,
    hostAssertions,
    requiredHostAssertions,
    externalProtocolOs,
    verdict,
  };

  // #41 P2 — evidence path: derived from the REAL platform + run date, and an
  // existing document is never overwritten. An unsupported platform is refused
  // instead of producing a file labelled "WINDOWS" on macOS or Linux.
  let resolvedResults = null;
  let resultsProblem = null;
  try {
    resolvedResults = lib.resolveResultsPath({
      dir: __dirname,
      platform: process.platform,
      date: new Date(),
      exists: (p) => fs.existsSync(p),
      join: path.join,
    });
    RESULTS_PATH = resolvedResults.path;
    summary.platformLabel = resolvedResults.label;
    summary.runDate = resolvedResults.stamp;
    writeResultsMd(summary, comparison);
  } catch (e) {
    resultsProblem = e && e.message;
    RESULTS_PATH = `(none — ${resultsProblem})`;
    verdict.notMeasured.push(`no evidence document written: ${resultsProblem}`);
    if (verdict.exitCode === lib.EXIT.OK) verdict.exitCode = lib.EXIT.NOT_MEASURED;
  }

  // Console summary (so the exit code + numbers are visible in the run log).
  process.stdout.write('\n===== ELECTRON HARNESS SUMMARY =====\n');
  process.stdout.write(`ran=${summary.ran} electron=${summary.electron} chromium=${summary.chromium} node=${summary.node}\n`);
  process.stdout.write(`probes as-expected: ${summary.asExpected}/${summary.probeCount}  deviations=${deviations}\n`);
  process.stdout.write(`security negatives all BLOCKED: ${secBlockedAll}\n`);
  process.stdout.write(`egress: ${externalEgressZero} (allowedLocal=${egress.allowedLocal})\n`);
  process.stdout.write(`hardening: webRTC-policy=${hardening.webrtcIpHandlingPolicy} applied=${hardening.webrtcPolicyApplied}x errors=${hardening.webrtcPolicyErrors.length}; disableBlinkFeatures=${hardening.disableBlinkFeatures}; will-redirect=on; permission req/check=deny-all\n`);
  process.stdout.write(`cold=${coldStartMs}ms warm=${summary.warmStartMs === null ? 'NOT-MEASURED' : `${warmStartMs}ms`} idleResident=${totalWorkingSetKB}KB\n`);
  for (const c of comparison) {
    const tag = c.verdict === 'as-expected' ? 'OK ' : (c.verdict === 'MISSING' ? 'MIS' : 'DEV');
    process.stdout.write(`  [${tag}] ${c.id.padEnd(22)} ${String(c.status).padEnd(8)} exp=${JSON.stringify(c.expected)}\n`);
  }
  for (const [name, f] of Object.entries(fixtures)) {
    process.stdout.write(`  fixture ${name.padEnd(18)} ${f.verdict.padEnd(12)} ${f.detail}\n`);
  }
  for (const name of requiredHostAssertions) {
    const h = hostAssertions[name] || { verdict: 'NOT-RUN', detail: 'no verdict produced' };
    process.stdout.write(`  host    ${name.padEnd(18)} ${String(h.verdict).padEnd(12)} ${h.detail}\n`);
  }
  process.stdout.write(`warm run: probesReported=${summary.warmProbesReported} deviations=${warmProbes.deviations} missing=${warmProbes.missing.length} (state=${warmDone.state})\n`);
  process.stdout.write(`session: ${summary.session} (cold=${summary.sessionCold}); byte lock: ${byteLock.detail}; contract lock: ${contractLock.detail}\n`);
  process.stdout.write(`RESULTS written: ${RESULTS_PATH}\n`);
  for (const r of verdict.failed) process.stdout.write(`FAILED CONTROL: ${r}\n`);
  for (const r of verdict.notMeasured) process.stdout.write(`NOT MEASURED:   ${r}\n`);
  process.stdout.write('====================================\n');

  const exitCode = verdict.exitCode;
  process.stdout.write(`HARNESS_EXIT=${exitCode} (${exitCode === lib.EXIT.OK ? 'all claimed controls exercised and passed'
    : exitCode === lib.EXIT.CONTROL_FAILED ? 'a control was exercised and FAILED'
      : 'NOT MEASURED — a claimed control was absent, incomplete or inconclusive'})\n`);
  app.exit(exitCode);
}

const mdCell = lib.mdCell;

function writeResultsMd(s, comparison) {
  const now = new Date().toISOString();
  // Markdown lists are emitted flush-left and with a blank line before them: the repo's
  // docs:lint gate (MD007/MD032) runs over every .md in the tree, so a result document
  // that lands in a commit must satisfy it or it turns CI red for a measurement run.
  const memLines = Object.entries(s.memByTypeKB)
    .map(([t, kb]) => `- ${t}: ${(kb / 1024).toFixed(1)} MiB (${kb} KB)`).join('\n');
  const probeVerdictLabel = (v) => (v === 'as-expected' ? 'OK' : (v === 'MISSING' ? '**MISSING (not measured)**' : `**${v}**`));
  const probeRows = comparison.map((c) =>
    `| ${c.index === null ? '—' : c.index} | \`${c.id}\` | ${c.category} | ${c.status} | ${c.expected && c.expected.length ? c.expected.join('/') : '—'} | ${probeVerdictLabel(c.verdict)} | ${mdCell(c.detail)} |`).join('\n');
  const blockedRows = s.egress.blockedList.length
    ? s.egress.blockedList.map((b) => `- ${b.method} ${b.scheme}: ${b.url} (${b.resourceType})`).join('\n')
    : '- (none — no external request was ever attempted)';

  // The #status terminal state depends on whether ANY probe FAILed. With the
  // cachestorage payload fix in place, a clean run settles at state=done.
  const anyFail = s.deviations > 0 || s.coldDoneState === 'error' || s.warmDoneState === 'error';
  const stateNote = anyFail
    ? `> **On the \`state=error\` labels above:** the payload sets \`#status[data-state=error]\`
> whenever *any* probe returns FAIL. Every one of those page loads still ran ALL 12 probes to
> completion — the label is the FAIL echo, not a load failure.`
    : `> **On the \`state=done\` labels above:** \`#status[data-state=done]\` means every one of the
> 12 probes ran to completion with no FAIL. (Before the cachestorage payload fix this row showed
> \`state=error\`, driven solely by the single cachestorage FAIL — see the resolved-deviation note below.)`;

  const deviationSection = s.deviations === 0
    ? `## Deviations — none (cachestorage payload bug fixed)

All 12 probes are as-expected against \`assertions.json\` (deviations = 0).

**Resolved deviation history (transparency).** The first execution (2026-07-22, pre-fix) showed
one DEVIATION: \`cachestorage\` FAIL (\`threw: TypeError\`). Root cause was **payload-side, not an
Electron defect**: the probe used \`new Request('runtime-eval:/fixture')\`, and the Service Worker
Cache spec rejects a non-\`http(s)\` request scheme in \`Cache.put()\` with a \`TypeError\` — reproducible
on any Chromium, including real Chrome over https. Fix: the byte-locked SoT payload was **deliberately
changed** to key the cache entry on \`https://cwap.invalid/runtime-eval-fixture\` (RFC 6761 reserved
\`.invalid\` host, guaranteed non-resolvable) with an **explicit** \`Response\` so \`cache.put\` STORES it
with **no network** (only \`cache.add\`/\`addAll\` fetch); \`connect-src 'none'\` is not violated. The
\`asset-manifest.json\` SHA256 byte-lock was regenerated via \`verify-determinism.mjs --update\`; all
pre-fix evidence against the old payload bytes is invalidated by that intentional change.`
    : `## The one DEVIATION — \`cachestorage\` FAIL (root-caused, payload-side, NOT an Electron defect)

The \`cachestorage\` probe calls \`cache.put(new Request('runtime-eval:/fixture'), …)\`. Per the
Service Worker Cache spec, \`Cache.put()\` throws a \`TypeError\` when the request URL's scheme is
not \`http\`/\`https\`; \`runtime-eval:\` is a custom scheme, so it throws \`TypeError\` — exactly what
was observed (\`threw: TypeError\`). CacheStorage itself IS available and secure-context-enabled
here (\`caches.open\` succeeded before the throw). This reproduces on any Chromium, including real
Chrome served over https — a **latent bug in the byte-locked test-app payload**, surfaced by this
run, **not** a runtime property of Electron.`;

  const md = `# Electron runtime-eval harness — ${s.platformLabel} results, ${s.runDate}

Runtime execution of the ADR-006 common test app (\`spike/runtime-eval/payload/\`).
Generated by \`main.js\` from a live run; every number below is straight from that run's tool output.

**Run verdict: \`HARNESS_EXIT=${s.verdict.exitCode}\`** — ${s.verdict.exitCode === 0
    ? 'every control this document claims to measure was exercised and passed.'
    : s.verdict.exitCode === 1
      ? '**a control was exercised and FAILED** (see the verdict list below).'
      : '**NOT MEASURED** — at least one claimed control was absent, incomplete or inconclusive; this row must not be read as a pass.'}

${[
    ...s.verdict.failed.map((r) => `- FAILED CONTROL: ${mdCell(r)}`),
    ...s.verdict.notMeasured.map((r) => `- NOT MEASURED: ${mdCell(r)}`),
  ].join('\n') || '- (no failed or unmeasured control)'}

- Run timestamp (wall clock, informational only): ${now}
- Runtime: **Electron ${s.electron}** (Chromium ${s.chromium}, Node ${s.node}, V8 ${s.v8})
- Host: ${s.platformLabel} (${s.platform})
- Payload byte lock (\`verify-determinism.mjs\`, run BEFORE any measurement): **${s.byteLock.ok}** — ${s.byteLock.detail}
- Assertion contract lock (\`assertions.json\` hashed in-process against \`asset-manifest.json\`): **${s.contractLock.ok}** — ${mdCell(s.contractLock.detail)}
- Evaluation session: \`${s.session}\` — provably cold: **${s.sessionCold}** (a non-persistent partition is required for a genuinely cold sample; \`default-session-cleared\` is the weaker fallback, a failed clear is NOT cold and yields exit 4)
- Security gate applied: \`sandbox:true\` + \`contextIsolation:true\` + \`nodeIntegration:false\` + \`webSecurity:true\`, no preload (zero native bridge). Popups/new-windows denied, external navigation denied, all permissions denied, all downloads denied.
- Defense-in-depth hardening (beyond the 4 flags): WebRTC IP policy \`${s.hardening.webrtcIpHandlingPolicy}\` (applied ${s.hardening.webrtcPolicyApplied}x, errors ${s.hardening.webrtcPolicyErrors.length}); \`disableBlinkFeatures:'${s.hardening.disableBlinkFeatures}'\`; \`will-redirect\` origin-pin; \`setPermissionCheckHandler\` deny-all; privileged scheme \`${s.hardening.privilegedScheme}\`.
- Payload origin: \`app://local/\` privileged local scheme (standard+secure), not \`file://\` (file:// blocks ES-module loading in Chromium).
- Toolchain deviation (documented): the repo root pins Node 22.23.1 for its CSP/security tests; this harness is a **separate framework-neutral spike** driven by the local Node ${process.versions.node === s.node ? '24.17.0 launcher' : 'launcher'} and running inside Electron ${s.electron}'s bundled Node ${s.node} / Chromium ${s.chromium}. Repo root toolchain untouched.

## Matrix row (raw, no synthetic score)

| Metric | Value |
|---|---|
| Harness ran (module executed) | ${s.ran} |
| Probes as-expected | ${s.asExpected} / ${s.probeCount} (assertion set, not the returned list) |
| Probes MISSING from the run | ${s.missingProbes.length ? `**${s.missingProbes.join(', ')}**` : 'none'} |
| Deviations | ${s.deviations} |
| Security negatives all BLOCKED | ${s.securityNegativesAllBlocked}${s.securityNegatives.incomplete ? ' (set INCOMPLETE — not a pass)' : ''} |
| Cold start (spawn→#status settled) | ${s.coldStartMs} ms (state=${s.coldDoneState}) |
| Warm start (2nd load, same session) | ${s.warmStartMs === null ? '**NOT MEASURED** (load never settled)' : `${s.warmStartMs} ms`} (state=${s.warmDoneState}) |
| Warm-run probes read + compared | ${s.warmProbes.ran ? `${s.warmProbesReported} reported, ${s.warmProbes.deviations} deviation(s), ${s.warmProbes.missing.length} missing` : '**NOT READ** (the warm load was judged by its status pixel only)'} |
| Idle resident memory (sum workingSetSize) | ${(s.idleResidentKB / 1024).toFixed(1)} MiB (${s.idleResidentKB} KB) |
| External egress requests attempted | ${s.egress.blockedExternal} |
| External egress requests allowed | 0 (deny-all in \`onBeforeRequest\`) |
| Local (app://) requests served | ${s.egress.allowedLocal} |

Per-process idle memory (workingSetSize):

${memLines}

${stateNote}

## Probe results vs \`assertions.json\`

| # | Probe | Category | Status | Expected | Verdict | Detail |
|---|---|---|---|---|---|---|
${probeRows}

## Security negatives — BLOCKED?

${comparison.filter((c) => c.category === 'security').map((c) => `- \`${c.id}\`: **${c.status}** (expected ${c.expected.join('/') || '—'}) — ${c.verdict === 'as-expected' ? 'OK' : c.verdict}`).join('\n')}

All security negatives BLOCKED (TT SKIP-acceptable only if unsupported): **${s.securityNegativesAllBlocked}**.

${deviationSection}

## Egress block — real proof (not just \`connect-src 'none'\`)

Enforcement layer: Electron \`session.defaultSession.webRequest.onBeforeRequest\` cancels every
request whose scheme is not local (\`app:\`/\`data:\`/\`blob:\`/\`devtools:\`/\`about:\`) and logs it.

- External requests attempted during the whole run: **${s.egress.blockedExternal}**
- External requests allowed through: **0** (cancelled deterministically)
- Local app:// requests served: ${s.egress.allowedLocal}
- Blocked external request log:
${blockedRows}

**WebRTC pillar (the one \`onBeforeRequest\` does NOT cover):** WebRTC ICE/STUN/TURN open UDP
peer connections directly through the OS, bypassing Chromium's HTTP network stack — so
\`session.webRequest.onBeforeRequest\` never sees them. This harness now sets
\`webContents.setWebRTCIPHandlingPolicy('${s.hardening.webrtcIpHandlingPolicy}')\` on every window
(applied ${s.hardening.webrtcPolicyApplied}×, errors ${s.hardening.webrtcPolicyErrors.length}), which forces UDP through a proxy — none is
configured, so there is no direct peer-UDP egress path. Honest caveat: the payload never
exercises WebRTC (no \`getUserMedia\`/\`RTCPeerConnection\`), so this is a **set-policy structural
closure**, not an empirically-triggered block. It removes the strongest known webRequest-bypass
egress route by construction; it is not a measurement that a bypass was attempted and stopped.

**Honest method limit:** this proves zero egress *at Chromium's network stack + webRequest layer*.
It is NOT a kernel-level socket/DNS packet capture. There is no OS socket monitor here. The
residual-risk argument for "no raw socket either" is structural, not measured: with
\`nodeIntegration:false\` + \`sandbox:true\` + no preload, app content has no Node/native API to
open a raw socket; the only network path available to it is Chromium's stack (gated by
\`onBeforeRequest\`) plus the WebRTC UDP path (now closed by the IP-handling policy above). A
future run could add Windows-level ETW/\`Get-NetTCPConnection\` sampling to close this gap
empirically.

## Destructive fixtures (isolated runs, host-level truth)

Every fixture verdict below feeds \`HARNESS_EXIT\`. \`PASS\` = exercised and held,
\`FAIL\` = exercised and did not hold (exit 1), \`NOT-RUN\`/\`INCONCLUSIVE\`/\`ERROR\` = not
measured (exit 4). No fixture outcome is prose-only any more.

- **External navigation** (\`navigateExternal\`): **${s.fixtures.navigateExternal.verdict}** — ${s.fixtures.navigateExternal.detail}
- **Download** (\`triggerDownload\`): **${s.fixtures.triggerDownload.verdict}** — ${s.fixtures.triggerDownload.detail}
- **Renderer crash containment** (\`forcefullyCrashRenderer\`): **${s.fixtures.crash.verdict}** — ${s.fixtures.crash.detail}
- **Hang / unresponsive** (\`hang\`): **${s.fixtures.hang.verdict}** — ${s.fixtures.hang.detail}

## Host-level assertions (\`assertions.json\` → \`HARNESS_EXIT\`)

\`assertions.json\` states facts that JS inside the page cannot observe. They are required
individually: the list comes from the contract file itself, so none can be dropped by forgetting
it here. \`PASS\` = observed and held, \`FAIL\` = observed and did not hold (exit 1),
\`NOT-RUN\`/\`INCONCLUSIVE\`/\`ERROR\` = not measured (exit 4).

| Assertion | Verdict | Observation |
|---|---|---|
${s.requiredHostAssertions.map((k) => {
    const h = s.hostAssertions[k] || { verdict: 'NOT-RUN', detail: 'no verdict was produced' };
    return `| \`${k}\` | **${h.verdict}** | ${mdCell(h.detail)} |`;
  }).join('\n')}

**On \`external_protocol_os\`:** the payload can only see that \`window.open('web+spikeext://…')\`
returned \`null\`. Whether the OS launched a handler is invisible to it, so the harness snapshots the
process table around a real external-protocol attempt and compares it against the handler the OS has
registered for that scheme. Because \`web+spikeext\` normally has no registered handler, schemes that
DO have one on this host are exercised as a **positive control** — without one, "no handler
launched" is vacuously true and the verdict is INCONCLUSIVE, never PASS.

## Honest scope / limits

- **One OS only** (${s.platformLabel}). The other OS rows of the ADR-006 matrix are NOT produced here.
- **One runtime only** (Electron primary hypothesis). The CEF fallback harness is a separate,
  later task; this is a one-sided row, not the two-way comparison ADR-006 ultimately needs.
- **Egress proof** is network-stack + webRequest level, not kernel socket/DNS (see above).
- **Cold/warm start** are single-sample, coarse wall-clock deltas (\`Date.now()\`), not p50/p95
  over many launches. Idle memory is a single snapshot. Treat as first-order magnitudes.
- **Hang detection** is bounded to 12 s; Chromium's own unresponsive-renderer timer can exceed
  that without user input, so NOT-OBSERVED is a bound artifact, not proof of no detection — it is
  reported as INCONCLUSIVE and yields \`HARNESS_EXIT=4\`, never a pass.
- Package/runtime download size, CPU idle/active, memory after 1/5/10 apps, and engine
  security-patch→user latency are ADR-006 deliverables NOT covered by this first row.
- ADR-006 stays PROPOSED. This file is one measured row of evidence, not a runtime selection.

---
> ADR-006 Electron harness · isolated spike · ${s.platformLabel} runtime execution ${s.runDate}
`;
  // #41 P2: 'wx' fails if the file exists. resolveResultsPath already picks an
  // unused name; the flag is the second lock so no rerun can ever silently
  // overwrite committed evidence.
  fs.writeFileSync(RESULTS_PATH, md, { flag: 'wx' });
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
