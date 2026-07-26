'use strict';
// Real-browser E2E probe for Issue #11 (M1B, ASI02 exfil boundary).
//
// WHY a bespoke Electron harness and not a Node-only mock: CSP `connect-src`
// enforcement is a BROWSER-ENGINE behaviour. Node's fetch() never evaluates
// CSP headers, so a Node-only test can at best assert "the header string
// looks right" — that already exists (tests/security/enforcement-regression
// .test.js, closes #10) and is a config-level check, not a runtime one. To
// prove the exfil boundary actually holds we need a real engine to receive
// the header and enforce it. This harness drives Electron's bundled
// Chromium — already an existing devDependency of the isolated
// spike/runtime-eval/harness/electron spike (electron@43.2.0); NO new
// package was installed for this issue — against the REAL production
// header map produced by src/security/csp.js from
// docs/security/csp-baseline.json (the actual served-header SoT, not a
// hand-written fixture).
//
// Two modes, selected by --mode=:
//   protected   — serves the header map exactly as buildHeaderMap() emits
//                 it. The exfil attempt MUST be blocked (0 attacker hits).
//   unprotected — serves the SAME page, SAME script, SAME everything,
//                 except the Content-Security-Policy header is deliberately
//                 stripped. This is the mandated discrimination probe: if
//                 the exfil were blocked in THIS mode too, the "protected"
//                 result would be meaningless (something else was doing the
//                 blocking, not CSP) — see enforcement-entrypoint test
//                 discipline already used elsewhere in this repo.
//
// Isolation: this script and its fixtures are new files under tests/e2e/.
// It does not read, import from, or write into spike/runtime-eval/** (the
// two files dirty in the working tree at task start are untouched).

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { app, BrowserWindow, protocol, session } = require('electron');

const MODE = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=protected').split('=')[1];
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

app.disableHardwareAcceleration();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'e2eprobe',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

// Load the REAL production CSP module (ESM) from a CommonJS runner via
// dynamic import(). This is the exact module tests/security/*.test.js
// exercise at the unit level — here it is exercised end-to-end.
function loadRealHeaderMap() {
  const cspModuleUrl = require('node:url').pathToFileURL(
    path.join(REPO_ROOT, 'src', 'security', 'csp.js'),
  ).href;
  return import(cspModuleUrl).then(({ loadBaseline, buildHeaderMap }) => buildHeaderMap(loadBaseline()));
}

async function main() {
  // --- attacker loopback server: the exfil "destination". Only counts hits;
  //     never inspects payload content (nothing sensitive is ever sent).
  let attackerHits = 0;
  const attacker = http.createServer((_req, res) => {
    attackerHits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('received');
  });
  await new Promise((resolve) => attacker.listen(0, '127.0.0.1', resolve));
  const attackerPort = attacker.address().port;
  // A DIFFERENT loopback port is a DIFFERENT origin under connect-src's
  // exact-origin match — this is not the app's own origin, so it must never
  // be reachable, exactly like a real attacker-controlled exfil endpoint.
  const attackerUrl = `http://127.0.0.1:${attackerPort}/exfil`;

  const realHeaders = await loadRealHeaderMap();
  const servedHeaders = { ...realHeaders };
  if (MODE === 'unprotected') {
    delete servedHeaders['Content-Security-Policy']; // the discrimination cut
  }

  protocol.handle('e2eprobe', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const full = path.join(FIXTURES_DIR, rel);
    if (!full.startsWith(FIXTURES_DIR)) return new Response('forbidden', { status: 403 });
    try {
      const buf = fs.readFileSync(full);
      const ext = path.extname(full);
      const ct = ext === '.js' ? 'text/javascript' : ext === '.html' ? 'text/html' : 'application/octet-stream';
      return new Response(buf, { status: 200, headers: { 'content-type': ct, ...servedHeaders } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });

  const consoleLog = [];
  win.webContents.on('console-message', (event, level, message) => {
    const msg = event && typeof event.message === 'string' ? event.message : message;
    if (consoleLog.length < 40) consoleLog.push(msg);
  });

  await win.loadURL(`e2eprobe://local/index.html?attacker=${encodeURIComponent(attackerUrl)}`);

  // Bounded wait for window.__result.done (max 8s; the page itself settles
  // within ~300ms of the fetch outcome).
  const t0 = Date.now();
  let result = null;
  while (Date.now() - t0 < 8000) {
    try {
      result = await win.webContents.executeJavaScript('window.__result');
    } catch {
      /* transient eval error during navigation — retry within the bound */
    }
    if (result && result.done) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const out = {
    mode: MODE,
    attackerHits,
    result,
    cspHeaderServed: Object.prototype.hasOwnProperty.call(servedHeaders, 'Content-Security-Policy'),
    consoleLog,
  };
  process.stdout.write('PROBE_RESULT_JSON=' + JSON.stringify(out) + '\n');

  win.destroy();
  attacker.close();
  session.defaultSession.closeAllConnections?.();
  app.exit(0);
}

const WATCHDOG = setTimeout(() => {
  process.stderr.write('PROBE_TIMEOUT (15s)\n');
  app.exit(3);
}, 15000);
WATCHDOG.unref && WATCHDOG.unref();

app.whenReady().then(main).catch((e) => {
  process.stderr.write('PROBE_CRASH: ' + (e && e.stack) + '\n');
  app.exit(2);
});
app.on('window-all-closed', () => {
  /* controlled exit only, see main() */
});
