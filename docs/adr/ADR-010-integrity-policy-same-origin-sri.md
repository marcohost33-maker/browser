# ADR-010 — Enforce Subresource Integrity on Same-Origin Scripts and Styles

- Status: PROPOSED
- Date: 2026-08-13
- Decision owner: Marco
- Decision: serve `Integrity-Policy: blocked-destinations=(script style)` as part of
  the M1 response profile, making SRI metadata mandatory for script and style
  subresources — including same-origin ones
- Affects: `docs/security/csp-baseline.json` (0.3.0 → 0.4.0), `src/security/csp.js`,
  `src/security/header-values.js`, `docs/security/CSP_AND_SECURITY_HEADERS.md`
- Relates to: ADR-003 (endpoint trust / transport / deployment), ADR-004 (browser
  matrix — must record the support caveat below)

## Context

The M1 baseline pins `default-src 'none'` and `script-src 'self'`, which answers the
question *"which origins may supply a script?"* It does not answer *"is the script
that origin supplies the one we shipped?"*

`'self'` admits **any** same-origin script, unconditionally and without an integrity
check. That leaves a concrete gap: an attacker who can replace a file inside our own
origin — a writable storage bucket or CDN path, a poisoned build artefact, a
misconfigured deploy target — is executing script that every other control in the
baseline considers legitimate. CSP is satisfied, Trusted Types is satisfied (the
attacker's script simply never touches a DOM sink with a raw string), and the
connect-src exfil boundary only constrains *where* the payload can be sent, not
whether hostile code runs at all.

Subresource Integrity closes exactly this, but classic SRI is opt-in per element: it
protects only the tags that happen to carry an `integrity=` attribute, and it cannot
be audited from the response headers. `Integrity-Policy` inverts that — it makes the
absence of integrity metadata a **load failure** for the listed destinations.

APP-01 is unusually well placed for this: the app ships **no runtime scripts yet**.
Adopting the policy now costs nothing and makes the requirement structural before the
first script exists, rather than retrofitting it onto a working app later.

## Decision

1. **Serve `Integrity-Policy: blocked-destinations=(script style)`** on every
   response, wired through the same exact-contract layers as every other M1 header:
   the baseline supplies it, `header-values.js` pins the exact string, `csp.js`
   allowlists the name and rejects an empty blocked-destinations list.

2. **Both `script` and `style`, not just `script`.** `style-src 'self'` has the
   identical weakness, and a swapped stylesheet is not merely cosmetic — it is a
   UI-redressing and data-exfiltration primitive (`background: url(...)` on an
   attribute selector). There is no reason to protect one destination and not the
   other in an app that currently ships neither.

3. **No `sources` directive.** Omitting it is defined as `sources=(inline)`, which is
   the behaviour we want. Spelling it out would add a second value that can drift
   without changing behaviour.

4. **No `endpoints` directive, and the report-only twin is forbidden.**
   `Integrity-Policy-Report-Only` is added to `FORBIDDEN_SERVED_HEADER_NAMES`. It
   enforces nothing while emitting violation reports — it would both introduce
   telemetry this repo deliberately does not have (`report-to`, `reporting-endpoints`
   and `nel` are already forbidden) and read as *"integrity is handled"* in an audit
   while blocking nothing. Enforcement without telemetry is the deliberate choice.

5. **Deferred to ADR-004:** the browser-support caveat. `Integrity-Policy` is *not*
   Baseline (MDN: "limited availability"). Browsers that do not implement it ignore
   the header, so this is **defence in depth layered on top of `script-src 'self'`,
   not a replacement for it.** ADR-004's browser/E2E matrix must record where it is
   actually in force, exactly as it must for `trusted-types`.

## Consequences

**Intended.** Once the app ships its first script or stylesheet, that asset **must**
carry `integrity=` or it will not load, in every browser that implements the policy.
This is the point of the decision, and it is a fail-closed failure mode: a missing
hash breaks the asset loudly at build/test time rather than silently admitting an
unverified one.

**Cost.** The build must emit SRI hashes. For a static, dependency-free app this is a
hash-and-substitute step, but it is a real build-pipeline requirement that did not
exist before, and it lands on whoever introduces the first script.

**Measured constraint — a correct hash alone is not enough (issue #40).** Observed on
Electron 43.2.0 / Chromium while making the issue #11 exfil probe actually execute
(PR #39): under `blocked-destinations=(script style)` a **same-origin** script carrying
a **valid** SHA-256 `integrity` attribute is still refused. It executes only when the
request is additionally made in CORS mode:

```html
<!-- blocked, despite a valid hash -->
<script src="app.js" integrity="sha256-..."></script>

<!-- executes -->
<script src="app.js" integrity="sha256-..." crossorigin="anonymous"></script>
```

This is a property of the policy adopted here, not of the test fixture. **Every
same-origin script and stylesheet in a future T1 application must therefore be loaded
in CORS mode with integrity metadata**, and anything that generates or packages T1
application HTML must emit both the hash *and* `crossorigin`, keeping the hash in sync
with the bytes it ships.

The dangerous part is the failure mode, not the requirement: refusal is **silent**.
There is no CSP-violation event and no console error attributable to the cause. In the
probe it presented as a payload that simply never ran — which let a downstream
discrimination test pass vacuously, because "did not execute" and "executed and was
blocked" produced the same observable. Any harness relying on this policy must be able
to tell those two apart before it reports a result.

**Rejected alternative — `Integrity-Policy-Report-Only` first.** The usual advice is
to stage a new enforcing header through report-only. It is rejected here because the
app has **zero** scripts and styles today: there is nothing to break, so there is
nothing for a report-only phase to discover. Staging would only add a telemetry
dependency the repo does not want. Revisit this if the app ever ships assets before
the policy is in force — then the ordering advice applies again.

**Rejected alternative — `blocked-destinations=(script)` only.** See decision 2.

## Verification

- `npm test` — 194/194 (+3 tests: exact-value contract, phantom/narrowed values,
  report-only twin refused at the response boundary).
- Discrimination proved per layer rather than assumed. Removing any one of the five
  enforcement points turns the suite red: exact-value contract (193/1), required
  header name (154/25), report-only prohibition (193/1), `csp.js` phantom guard
  (193/1), `csp.js` name allowlist (147/32).
- `npm run csp:check` — baseline OK; the served map contains
  `Integrity-Policy: blocked-destinations=(script style)`.

## Open

- ADR-004 must record the browser-support matrix for this header.
- Whether a future build step emits SRI hashes automatically or fails the build when
  an asset lacks one is an implementation decision for the first script-shipping
  change, not for this ADR.
- The CORS-mode requirement recorded above lands in the package/verifier work
  (issue #24), which is where hash-to-bytes binding is actually implemented. That work
  must emit `crossorigin` alongside the hash; emitting only the hash produces assets
  that fail silently at runtime.
