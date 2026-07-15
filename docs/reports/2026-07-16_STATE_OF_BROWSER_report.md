# State of `browser` — Full Status Report

- Date: 2026-07-16
- Author: Vero (Claude Opus 4.8), for Marco
- Repository: `marcohost33-maker/browser` (private)
- Local clone: `C:\Users\marco\dev\browser`
- Canonical head at report time: `origin/main` @ `3fe912d`
- Work branch produced this session (local, **not pushed** — GitHub budget freeze):
  `vero/2026-07-16-standalone-reframe-and-report`
- Verification run locally this session: **179/179 security tests pass**, markdownlint
  **0 errors** across 28 docs (Node 24; the repo's exact Node 22.23.1 CI gate is a
  separate strict gate and does not block local test runs).

---

## 0. TL;DR

`browser` is a **standalone**, native, offline-capable **runtime program** meant to run
foreign web apps locally and replace cloud hosting — matured in trust classes
**T1 → T2 → T3** (north star T3 = arbitrary foreign web content). Today it is a
**very strong documentation + static-security + supply-chain-evidence foundation with
no runtime code yet**. The hard, honest verdict from the repo's own matrix stands:
**NOT production-ready** and **no runtime exists**. The next real move is not more
hardening — it is the **runtime spike (ADR-006)** and **product discovery (#14)** that
unblock the first shippable increment (T1: run owner-controlled offline webapps).

This session I: verified the build locally, decoded the branch/PR topology (no lost
work), recorded Marco's **standalone** decision as **ADR-008**, re-landed a reviewed
evidence-hardening addendum, reframed the highest-visibility docs, and produced this
report — all locally, ready for a single push when the budget returns.

---

## 1. What `browser` is (concept)

- A **native, offline-capable browser/webapp runtime program**. It executes foreign
  web applications **locally**, as a base for our own apps, to **replace
  Cloudflare-style cloud hosting**. Goals: offline, **no LLM tokens / API cost**,
  privacy-first, minimal attack surface. **Works without any AI.**
- **Standalone (ADR-008, 2026-07-16).** `browser` is not part of a "three-layer stack".
  `nigin-engine` and `browser-nigin` are **separate, independent repositories linked
  only by knowledge transfer** — not dependencies. `browser` must build, ship and be
  useful on its own.
- **MCP is internal + optional (ADR-008).** MCP consumption belongs *in* `browser` as
  an internal, optional capability, **off the T1 critical path**; it may also be run
  separately. No external `nigin-engine` contract dependency is assumed.

### Trust classes (ADR-005, ACCEPTED)

| Class | Meaning | Status |
|---|---|---|
| **T1** | Owner-controlled, signed offline packages — **first shipping increment** | target of first slice |
| **T2** | Curated third-party packages (gated; publisher verify + capability broker + rollback) | gated follow-up |
| **T3** | Arbitrary foreign web content — **north star / target state** | end state, many gates away |

T3 requires browser-grade site isolation, navigation/permission UI, certificate
handling, download safety, profile separation and a **maintained engine
security-patch SLA**. Not delivered early; "empty IPC permissions" ≠ safe for T3.

---

## 2. How far it is (verified state)

**Maturity ladder** (repo's own definition; no lower level may be described as higher):
Designed → Implemented → Verified → Production-ready.

**What genuinely exists and is verified (PASS-CI / locally re-verified):**

- **Static browser security foundation** (`src/security/*.js`, 13 test files, **179
  tests**): CSP emitted from one machine-readable baseline + independent exact M1
  contract; exact-origin `connect-src` allowlist; HTTPS-only remote + loopback-only
  HTTP dev; rejection of non-public / reserved / IPv6-mapped / localhost-misused
  origins (**IPv6 bypass fixed**); exact 2-year HSTS, `no-referrer`, canonical
  Permissions-Policy, strict COOP/COEP/CORP/MIME/framing; final in-process
  response-header readback; source-level ban on importing raw security primitives;
  negative tests for injection/drift/duplication/casing/downgrade.
- **Supply-chain + evidence foundation:** pinned public npm registry, `ignore-scripts`,
  frozen lockfile integrity gate, `npm ci --ignore-scripts`, high/critical vuln gate +
  archived `npm-audit.json`, SPDX SBOM, evidence manifest (schema 1.2) binding
  source/tool/registry/runner/hashes, 90-day immutable evidence artifact,
  SHA-pinned Actions on `ubuntu-24.04`, zizmor workflow audit.
- **Governance/docs:** Charter, ADRs 001–008, decision register, master + execution
  roadmaps, production-readiness matrix, threat/privacy models, MCP consumer profile,
  SECURITY.md, CODEOWNERS, Dependabot, PR evidence template, MIT license.

**What does NOT exist yet (be precise):**

- **No runtime. No application. No UI.** No Electron/CEF/Tauri, no TypeScript app, no
  package verifier, no vertical slice, no browser E2E, no accessibility evaluation, no
  release/staging/rollback pipeline. The static security work is a **framing-neutral
  foundation**, not a product.

**Repo's own conclusion (unchanged, and correct): NOT PRODUCTION-READY.**

---

## 3. Concept detail — the two open runtime decisions

- **ADR-006 (runtime framework, PROPOSED):** measured spike over Tauri 2/WRY,
  Electron/bundled Chromium, WebView2-direct; CEF flagged as a control candidate. For
  the T3 target the shortlist leans **Chromium (Electron/CEF)** for inherited
  process-level site isolation + project-controlled patch cadence. **No framework
  accepted yet** — decision must come from measured cut criteria, not marketing.
- **ADR-007 (package format, PROPOSED):** two-track verifier spike — Track A
  `.swbn`/IWA (signed web bundle) vs Track B minimal signed manifest-root package,
  both against one adversarial corpus (payload tamper, path traversal, Unicode/case
  collisions, replay, rollback, key rotation). **No format decided yet.**
- **Evidence-hardening addendum (re-landed this session):** corrects four overbroad
  claims — site-isolation ≠ per-origin isolation; patchability is an end-to-end
  latency property; CEF must be a real candidate or dropped from prose; runtime choice
  must stay neutral until the common spike runs.

---

## 4. Roadmap (critical path + gates)

**Critical path (post-ADR-008, T1-first, no external contract gate):**

```text
#14 product discovery (primary user + one read-only task + go/pivot/stop)
  -> ADR-006 runtime spike (#23)  +  ADR-007 package spike (#24)
  -> secure app/runtime bootstrap
  -> T1 owner-controlled offline vertical slice (run a signed local webapp)
  -> browser / privacy / accessibility / security verification
  -> reproducible build, staging, provenance, rollback + incident gate
  -> narrow release  ... then T2 (curated) ... then T3 (arbitrary foreign content)
```

**Gate ladder (from the production-readiness matrix):** G0 governance · G1 product ·
G2 endpoint/transport (largely superseded → re-scope to runtime navigation/network
policy) · G3 MCP/contract (now **optional/internal**, ADR-008) · G4 build foundation
(mostly PASS-CI) · G5 static browser security (PASS-CI) · G6 runtime security/privacy
(BLOCKED — no runtime) · G7 accessibility (BLOCKED — no UI) · G8 supply-chain/release ·
G9 deployment/ops. Green today: **G4/G5 + parts of G0/G8**. Everything runtime-shaped
is BLOCKED purely because the runtime does not exist yet.

---

## 5. What to do — open issues & disposition

17 open issues. Recommended dispositions (see blind spots §6 for the reframe drift):

| # | Title (short) | P | Recommended action |
|---|---|---|---|
| 14 | product discovery: user, read-only task, value decision | P0 | **DO NEXT** — unblocks everything |
| 23 | T3 runtime spike: CEF vs Electron vs Chromium | P0 | **DO NEXT** — ADR-006 measured spike |
| 24 | package/secure-update spike: .swbn/IWA vs minimal | P0 | **DO** — ADR-007 two-track spike |
| 30 | offline acquisition modes for foreign webapps | P0 | design task; feeds T1 |
| 25 | T2 publisher admission, capability approval, removal | P1 | defer until T1 lands |
| 21 | reframe: native offline runtime + trust-class ADRs | P0 | **CLOSE** — delivered by ADR-005/006/007 (+008) |
| 13 | ADR-003 endpoint trust / transport / CORS | P0 | **CLOSE/RELABEL — SUPERSEDED** by ADR-005/008 (remote-endpoint product obsolete) |
| 2 | vertical slice: "privacy-first MCP client webapp" | – | **CLOSE/RELABEL — SUPERSEDED** product framing (ADR-008); re-file as T1 offline slice |
| 20 | independent final-head review for PR #17 | P0 | governance; PR #17 already merged — verify/close |
| 4 | M1B production foundation: build/security/evidence | P0 | keep; re-scope to runtime |
| 7 | ADR-004 framework/build under CSP + a11y | – | **folds into ADR-006** — dedupe |
| 8 | Security-Auflagen M1 (CSP/contract/allowlist/CI) | – | mostly delivered by merged #9/#15/#17 — verify/close |
| 5 | hostile MCP + browser test corpus | – | keep for runtime; MCP part now optional |
| 11 | exfil + prompt-injection E2E (ASI01/02) | – | keep; needs runtime first |
| 6 | release governance: privacy/vuln/rollback | – | keep for release gate |
| 27 | duplicate-write idempotency guard for automation | P1 | small process lever; do when convenient |
| 29 | mirror cosign signer-identity regexp (Aegis #5 F1) | P2 | **now producer-neutral** under ADR-008; keep as hardening idea |

> Issue closes are **not** done in this session (they are outward GitHub actions and
> the next people rely on visible issue state). They are recommended here for a
> deliberate, batched pass.

---

## 6. Blind spots found this session

1. **Reframe drift (biggest).** ~50 references across 12 docs still assert the
   "three-layer stack" and a **hard `nigin-engine` contract dependency** (README,
   CHARTER, ROADMAP, MASTER_ROADMAP, OPEN_DECISIONS, IMPLEMENTATION_STATUS,
   PRODUCTION_READINESS_MATRIX, ADR-001, ADR-002, reframe checklist, product-discovery
   protocol, VALIDATION_AND_OPEN_TOPICS). Contradicts Marco's standalone decision.
   → **Fixed at the source with ADR-008 (tie-breaker) + README/CHARTER banners; full
   mechanical sweep tracked as remaining work.**
2. **Superseded issues left open** (#13 ADR-003, #2 MCP-client-webapp) — stale product
   framing presented as live work. → disposition table §5.
3. **Parked reverted addendum** (`agent/browser-reframe-evidence-hardening-20260715`)
   was correct content reverted only for being "unreviewed on main". Risk: good
   corrections silently lost. → **reviewed + re-landed** this session.
4. **Local-dev friction / CI-parity gap.** The toolchain gate demands **exactly Node
   22.23.1 / npm 10.9.8**; Marco's machine runs Node 24 → `toolchain:check` fails
   locally even though tests pass. For a "more local, less CI" future this is a
   papercut. → lever in §8 (documented local-CI path + optional nvm pin).
5. **Stale merged branches** clutter origin (`fix/header-validation-roadmap-refresh`
   =PR#17, `agent/browser-reframe-crossfamily-gates` =PR#22, `feat/cwzl-m0-browser`
   =PR#1). Harmless but noisy; delete needs a push → deferred under freeze.
6. **`feat/cwzl-m0-browser` carries 1–2 possibly-unmerged commits** ("Wissenstransfer
   AllScan→Browser + Compliance-Register-Seed"). Low priority; verify before deleting
   that branch.

---

## 7. What I changed this session (local, not pushed)

Branch `vero/2026-07-16-standalone-reframe-and-report` (3 commits on top of `3fe912d`):

1. `docs(reframe): ADR-008 browser is standalone; MCP internal/optional` — new
   `docs/adr/ADR-008-...md` + README + CHARTER banner/principle updates.
2. `docs: add browser reframe evidence hardening addendum` — cherry-pick of the
   reviewed, Marco-authored addendum (`e74221f`) back onto the line.
3. `docs: mark evidence-hardening addendum reviewed/re-landed` — honest provenance.
4. This report (`docs/reports/2026-07-16_STATE_OF_BROWSER_report.md`).

No source/test/workflow files touched → **179 tests still pass, lint clean**. One push
lands the whole thing when budget returns.

---

## 8. Topic 1 — alternatives to pushing (and cutting CI cost)

**Key fact:** `git push` itself is **free**. GitHub bills **Actions (CI) minutes**.
The freeze is really a *CI-cost* freeze, not an access problem — I already have full
local access via Claude Code (no Cursor needed; Cursor wouldn't change GitHub billing
either).

Options, cheapest first:

1. **Local-only (what we're doing).** Commit + local merges on a branch, push nothing.
   **Zero cost.** One push later = one CI run for the whole batch. Best under freeze.
2. **Local CI parity (recommended lever).** Run the exact CI steps locally so we get
   verification without Actions: `npm test` (✓ 179 pass), `npm run csp:check`,
   `lockfile:check`, `audit:ci`, markdownlint. Add a `verify:local` script + optional
   pre-push hook. This makes "more local, less CI" safe.
3. **Push without CI when needed:** `[skip ci]` / `[ci skip]` in the commit subject
   skips workflow runs; push to backup/collaborate without burning minutes.
4. **Structural CI-cost cuts (do once, save forever):**
   - trigger CI on **PR-to-main only**, not every push;
   - **path filters** — skip CI for docs-only changes (this repo is 90% docs right now,
     so this alone would have avoided most recent burn);
   - `concurrency: cancel-in-progress` to kill superseded runs;
   - trim the job matrix; cache npm.
5. **Self-hosted runner (structural fix for cost anxiety).** Run Actions on Marco's own
   PC — **self-hosted minutes are not billed**. These repos are private, so the usual
   "never on untrusted PRs" caveat is manageable. Eliminates the Actions-minute cost
   entirely for our own work.
6. **Stay under the free tier.** Private repos include a monthly free Actions
   allotment; the $50 was overage. Options 3–4 keep us under it sustainably. *(Exact
   free-minute numbers depend on the plan — verify in GitHub Billing before relying on
   a figure.)*

**Recommendation:** keep working **local-only** now (option 1) + add **local CI parity**
(option 2). When budget returns, land option 4 (path filters + PR-only) in the first
push so future cost stays near zero — then a self-hosted runner (5) if we want CI
without ever touching the budget again.

---

## 9. Handoff — clean state for the next person

- **Read first:** this report → `docs/adr/ADR-008` (standalone decision) →
  `docs/IMPLEMENTATION_STATUS.md` + `docs/verification/PRODUCTION_READINESS_MATRIX.md`
  (honest evidence state) → `docs/MASTER_ROADMAP.md`.
- **Truth is standalone:** ignore any lingering "three-layer stack" / "requires
  `nigin-engine` contract" wording — ADR-008 overrules it until the sweep lands.
- **Next real work (in order):** #14 product discovery · ADR-006 runtime spike (#23) ·
  ADR-007 package spike (#24) → then the first **T1 owner-controlled offline vertical
  slice**. Static security is *done enough*; do not add more of it before the runtime
  exists.
- **Pending mechanical work:** full reframe doc-sweep (12 files, §6.1); batched issue
  disposition (§5); branch cleanup (§6.5) — all need a push, deferred under freeze.
- **Nothing is lost or broken.** Build is green locally; all changes are on one
  reviewable branch awaiting a single push.
