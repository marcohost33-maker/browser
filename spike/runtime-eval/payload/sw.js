// Minimal, deterministic service worker for the service-worker probe.
// It performs NO network fetch (connect-src 'none' forbids it and network in
// the result path is the test subject). It only proves the runtime can
// register, install and activate a service worker.
self.addEventListener('install', (event) => {
  // Activate immediately so navigator.serviceWorker.ready resolves promptly.
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
// Intentionally no 'fetch' handler: we never proxy or fabricate network.
