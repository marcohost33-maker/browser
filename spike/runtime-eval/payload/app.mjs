// Framework-neutral runtime-evaluation payload — probe runner (ADR-006).
//
// DETERMINISM CONTRACT (do not break):
//   * No Date.now(), performance.now(), Math.random() or any wall-clock value
//     is written into the results. Probe order is fixed; each probe carries a
//     stable integer index. The only variation across runs on a correct runtime
//     is the runtime name, which is derived from feature detection, not timing.
//   * Results are emitted into window.__spikeResults AND rendered into the DOM
//     (#results-json, #results-table) so every harness reads them identically.
//   * DOM is built with createElement/textContent only. Under
//     require-trusted-types-for 'script', assigning a string to innerHTML
//     throws — the payload itself must stay TT-clean (the TT probe deliberately
//     triggers the violation in an isolated try/catch).
//
// STATUS VOCABULARY:
//   PASS    capability worked as a correctly isolated runtime should.
//   BLOCKED a hostile / ungranted action was correctly denied (the SECURE
//           outcome for CSP, Trusted Types, popup, external protocol, IPC).
//   FAIL    outcome deviated from the isolated-runtime expectation.
//   READY   a destructive fixture (crash/hang/oversized/navigation/download) is
//           registered and callable by the harness, but NOT auto-executed here
//           because running it would destroy result collection. The harness
//           triggers these in isolated runs and measures host recovery.
//   SKIP    API genuinely absent in a non-security-relevant way.

const SCHEMA_VERSION = 'runtime-eval-results/v1';

// ---------------------------------------------------------------------------
// Fixed WebAssembly module: exports add(i32,i32)->i32. add(2,3) MUST equal 5.
// Standard hand-assembled module; embedding the bytes keeps the probe
// self-contained and deterministic (no network, no build step).
// ---------------------------------------------------------------------------
const WASM_ADD_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type: (i32,i32)->i32
  0x03, 0x02, 0x01, 0x00, // function section
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export "add"
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code: local.get 0/1, i32.add
]);

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------
function result(id, category, status, detail) {
  return { index: 0, id, category, status, detail: String(detail) };
}

// Each probe is an async function returning a {id,category,status,detail}.
// Order is fixed by this array; the index is assigned after collection.
const PROBES = [
  // -- capability probes -----------------------------------------------------
  async function moduleLoading() {
    try {
      const mod = await import('./probe-module.mjs');
      const ok = mod.MODULE_MARKER === 'runtime-eval:dynamic-module:v1'
        && mod.moduleAdd(2, 3) === 5;
      return result('module_loading', 'capability', ok ? 'PASS' : 'FAIL',
        ok ? 'static + dynamic ES module executed' : 'dynamic module marker/exec mismatch');
    } catch (e) {
      return result('module_loading', 'capability', 'FAIL', `import threw: ${e.name}`);
    }
  },

  async function indexedDbProbe() {
    if (typeof indexedDB === 'undefined') {
      return result('indexeddb', 'capability', 'SKIP', 'indexedDB undefined');
    }
    try {
      const value = await new Promise((resolve, reject) => {
        const open = indexedDB.open('spike-runtime-eval', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error || new Error('open failed'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put('fixed-value', 'fixed-key');
          tx.oncomplete = () => {
            const rtx = db.transaction('kv', 'readonly');
            const getReq = rtx.objectStore('kv').get('fixed-key');
            getReq.onsuccess = () => { db.close(); resolve(getReq.result); };
            getReq.onerror = () => { db.close(); reject(getReq.error); };
          };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
      });
      const ok = value === 'fixed-value';
      return result('indexeddb', 'capability', ok ? 'PASS' : 'FAIL',
        ok ? 'put/get round-trip ok' : `unexpected value: ${value}`);
    } catch (e) {
      return result('indexeddb', 'capability', 'FAIL', `threw: ${e.name}`);
    }
  },

  async function cacheStorageProbe() {
    if (typeof caches === 'undefined') {
      return result('cachestorage', 'capability', 'SKIP', 'caches undefined');
    }
    try {
      const cache = await caches.open('spike-runtime-eval');
      // Synthetic Request/Response — no network involved.
      const req = new Request('runtime-eval:/fixture');
      await cache.put(req, new Response('fixed-body'));
      const hit = await cache.match(req);
      const body = hit ? await hit.text() : null;
      await caches.delete('spike-runtime-eval');
      const ok = body === 'fixed-body';
      return result('cachestorage', 'capability', ok ? 'PASS' : 'FAIL',
        ok ? 'put/match round-trip ok' : `unexpected body: ${body}`);
    } catch (e) {
      return result('cachestorage', 'capability', 'FAIL', `threw: ${e.name}`);
    }
  },

  async function serviceWorkerProbe() {
    if (!('serviceWorker' in navigator)) {
      return result('service_worker', 'capability', 'SKIP', 'serviceWorker unavailable');
    }
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // Wait for an active worker (bounded by the runtime; no timers in results).
      await navigator.serviceWorker.ready;
      const active = !!(reg.active || (await navigator.serviceWorker.ready).active);
      return result('service_worker', 'capability', active ? 'PASS' : 'FAIL',
        active ? 'registered + activated' : 'registered but no active worker');
    } catch (e) {
      // Registration may be denied by policy (custom scheme / opaque origin).
      return result('service_worker', 'capability', 'BLOCKED', `register denied: ${e.name}`);
    }
  },

  async function wasmProbe() {
    if (typeof WebAssembly === 'undefined') {
      return result('webassembly', 'capability', 'SKIP', 'WebAssembly undefined');
    }
    try {
      const { instance } = await WebAssembly.instantiate(WASM_ADD_BYTES, {});
      const sum = instance.exports.add(2, 3);
      const ok = sum === 5;
      return result('webassembly', 'capability', ok ? 'PASS' : 'FAIL',
        ok ? 'add(2,3)==5' : `add(2,3)==${sum}`);
    } catch (e) {
      // If CSP blocks wasm (missing 'wasm-unsafe-eval') this is BLOCKED, not FAIL.
      const csp = /CompileError|CSP|compil/i.test(e.message || '');
      return result('webassembly', 'capability', csp ? 'BLOCKED' : 'FAIL', `threw: ${e.name}`);
    }
  },

  // -- security negative fixtures -------------------------------------------
  async function cspEvalProbe() {
    // script-src has no 'unsafe-eval' -> eval()/Function() MUST be blocked.
    try {
      // eslint-disable-next-line no-eval
      const v = (0, eval)('1+1');
      return result('csp_eval', 'security', 'FAIL', `eval executed, returned ${v}`);
    } catch (e) {
      return result('csp_eval', 'security', 'BLOCKED', `eval blocked: ${e.name}`);
    }
  },

  async function cspInlineScriptProbe() {
    // Injecting an inline <script> must not execute under script-src 'self'.
    try {
      const flag = { fired: false };
      const globalKey = '__spike_inline_fired__';
      window[globalKey] = () => { flag.fired = true; };
      const s = document.createElement('script');
      // textContent (not innerHTML) — TT-clean; CSP must still refuse to run it.
      s.textContent = `window['${globalKey}'] && window['${globalKey}']();`;
      document.head.appendChild(s);
      s.remove();
      delete window[globalKey];
      return result('csp_inline_script', 'security', flag.fired ? 'FAIL' : 'BLOCKED',
        flag.fired ? 'inline script executed' : 'inline script did not execute');
    } catch (e) {
      return result('csp_inline_script', 'security', 'BLOCKED', `insertion blocked: ${e.name}`);
    }
  },

  async function trustedTypesProbe() {
    // require-trusted-types-for 'script' -> assigning a raw string to innerHTML
    // MUST throw a TypeError (sink guarded). We assign to a DETACHED element so
    // no markup is injected even if enforcement is absent.
    if (typeof window.trustedTypes === 'undefined') {
      return result('trusted_types', 'security', 'SKIP', 'trustedTypes unsupported by runtime');
    }
    try {
      const div = document.createElement('div');
      div.innerHTML = '<img src=x onerror="/* would run without TT */">';
      return result('trusted_types', 'security', 'FAIL', 'string innerHTML assignment succeeded');
    } catch (e) {
      return result('trusted_types', 'security', 'BLOCKED', `TT sink blocked: ${e.name}`);
    }
  },

  async function popupProbe() {
    // window.open to an external target must be denied (returns null) in a
    // locked-down runtime with popups/new-windows disabled.
    try {
      const w = window.open('https://example.invalid/spike', '_blank', 'noopener');
      if (w) { try { w.close(); } catch { /* ignore */ } }
      return result('popup', 'security', w ? 'FAIL' : 'BLOCKED',
        w ? 'window.open returned a window' : 'window.open returned null');
    } catch (e) {
      return result('popup', 'security', 'BLOCKED', `open threw: ${e.name}`);
    }
  },

  async function externalProtocolProbe() {
    // Opening an external-protocol URL must not hand off to the OS. From JS we
    // can only observe that window.open is refused (null). The harness ALSO
    // asserts, at the OS level, that no external handler was launched.
    try {
      const w = window.open('web+spikeext://launch', '_blank', 'noopener');
      if (w) { try { w.close(); } catch { /* ignore */ } }
      return result('external_protocol', 'security', w ? 'FAIL' : 'BLOCKED',
        w ? 'external-protocol open returned a window' : 'external-protocol open refused');
    } catch (e) {
      return result('external_protocol', 'security', 'BLOCKED', `open threw: ${e.name}`);
    }
  },

  async function nativeIpcProbe() {
    // With zero grants, NO native bridge may be reachable from app content.
    // We enumerate the well-known injection points for each candidate runtime.
    const bridges = {
      'node.require': typeof window.require,
      'node.process': typeof window.process,
      'node.module': typeof window.module,
      'node.global': typeof window.global,
      'electron.ipcRenderer': typeof (window.electron && window.electron.ipcRenderer),
      'electron.electronAPI': typeof window.electronAPI,
      'webview2.chrome.webview': typeof (window.chrome && window.chrome.webview),
      'tauri.__TAURI__': typeof window.__TAURI__,
      'tauri.__TAURI_INTERNALS__': typeof window.__TAURI_INTERNALS__,
      'cef.cefQuery': typeof window.cefQuery,
      'ie.external.invoke': typeof (window.external && window.external.invoke),
    };
    const exposed = Object.entries(bridges)
      .filter(([, t]) => t !== 'undefined')
      .map(([k]) => k);
    // Note: WebView2 injects window.chrome.webview by design; a bridge being
    // PRESENT is only a FAIL if it is also CALLABLE without an explicit grant.
    // The payload cannot itself prove "grant"; it records the surface and the
    // harness confirms each listed bridge rejects ungranted calls.
    const detail = exposed.length ? `exposed: ${exposed.sort().join(', ')}` : 'no native bridge exposed';
    return result('native_ipc_zero_grant', 'security', exposed.length ? 'FAIL' : 'BLOCKED', detail);
  },

  // -- destructive fixtures (registered, not auto-executed) -----------------
  async function destructiveFixtures() {
    // Registered on window.__spikeFixtures for the harness to trigger in
    // isolated runs while it measures crash containment / host recovery /
    // hang detection / oversized-resource handling.
    const fixtures = {
      crash() {
        // Deep unbounded recursion → RangeError, or (in a native harness hook)
        // a deliberate renderer crash if the harness swaps in a real crasher.
        const boom = () => boom();
        boom();
      },
      hang(ms) {
        // Busy-wait to simulate an unresponsive renderer. Bounded arg is the
        // harness's responsibility; default is effectively "until killed".
        const target = typeof ms === 'number' ? ms : Number.POSITIVE_INFINITY;
        const start = performance.now();
        // eslint-disable-next-line no-empty
        while (performance.now() - start < target) { /* spin */ }
      },
      oversized() {
        // Allocate an oversized buffer to probe memory-pressure handling.
        // Kept out of the result path: only runs when the harness calls it.
        const chunks = [];
        // 64 * 32MiB = 2GiB attempted allocation.
        for (let i = 0; i < 64; i++) chunks.push(new Uint8Array(32 * 1024 * 1024).fill(1));
        return chunks.length;
      },
      navigateExternal() {
        // Real top-level navigation to an external origin. In a locked runtime
        // this MUST be denied by the will-navigate handler.
        window.location.assign('https://example.invalid/spike-navigation');
      },
      triggerDownload() {
        // Real download attempt. In a locked runtime the download handler MUST
        // deny it. Uses a data: URL so no network is involved.
        const a = document.createElement('a');
        a.href = 'data:application/octet-stream;base64,c3Bpa2U=';
        a.download = 'spike-fixture.bin';
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
    };
    window.__spikeFixtures = fixtures;
    const registered = Object.keys(fixtures).sort();
    return result('destructive_fixtures', 'fixture', 'READY',
      `registered on window.__spikeFixtures: ${registered.join(', ')}`);
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function run() {
  const probes = [];
  for (let i = 0; i < PROBES.length; i++) {
    let r;
    try {
      r = await PROBES[i]();
    } catch (e) {
      r = result(PROBES[i].name || `probe_${i}`, 'runner', 'FAIL', `probe threw: ${e && e.name}`);
    }
    r.index = i; // stable, deterministic ordering
    probes.push(r);
  }

  const summary = probes.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const results = {
    schema: SCHEMA_VERSION,
    // NB: deliberately NO timestamp. Determinism is asset+logic driven.
    probeCount: probes.length,
    summary,
    probes,
  };

  window.__spikeResults = results;
  render(results);
  return results;
}

function render(results) {
  const body = document.getElementById('results-body');
  if (body) {
    for (const p of results.probes) {
      const tr = document.createElement('tr');
      for (const [cls, text] of [
        [null, String(p.index)],
        [null, p.id],
        [null, p.category],
        [`status-${p.status}`, p.status],
        [null, p.detail],
      ]) {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = text; // TT-clean
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }
  const pre = document.getElementById('results-json');
  if (pre) pre.textContent = JSON.stringify(results, null, 2);
  const status = document.getElementById('status');
  if (status) {
    const failed = (results.summary.FAIL || 0) > 0;
    status.dataset.state = failed ? 'error' : 'done';
    status.textContent = failed
      ? `Done with ${results.summary.FAIL} FAIL result(s).`
      : `Done. ${results.probeCount} probes collected.`;
  }
}

run().catch((e) => {
  const status = document.getElementById('status');
  if (status) {
    status.dataset.state = 'error';
    status.textContent = `Runner crashed: ${e && e.name}`;
  }
  window.__spikeResults = {
    schema: SCHEMA_VERSION,
    probeCount: 0,
    summary: { FAIL: 1 },
    probes: [{ index: 0, id: 'runner', category: 'runner', status: 'FAIL', detail: String(e && e.name) }],
  };
});
