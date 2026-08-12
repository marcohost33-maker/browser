# State of `browser` — Full Status Report

- Date: 2026-07-16
- Author: Vero (Claude Opus 4.8), for Marco
- Repository: `marcohost33-maker/browser` (private at the time of this report;
  the repository was made public on 2026-08-13)
- Canonical head at report time: `origin/main` @ `3fe912d`
- Work branch produced this session (local, **not pushed** — GitHub budget freeze):
  `vero/2026-07-16-standalone-reframe-and-report`
- Verification run locally this session: **185/185 security tests pass** (was 179; +6
  from the Aegis-driven fixes), markdownlint **0 errors** across 29 docs (Node 24; the
  repo's exact Node 22.23.1 CI gate is a separate strict gate and does not block local
  test runs).
- Branch = **one reviewable local branch** on top of `3fe912d` (not pushed). Deep-quality
  pass added: standalone doc sweep (13 docs), a security audit (Aegis) with code fixes,
  and primary-source runtime/package research (Quella) folded into ADR-006/007. See §10.

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
evidence-hardening addendum, ran a **full standalone doc sweep** (13 files), added a
**local CI-parity gate** (`verify:local`), commissioned a **security audit** (Aegis —
no reachable P0; a real P1 threat-model overclaim + P2/P3 fixed with tests) and
**primary-source research** (Quella) that now grounds ADR-006/007, and produced this
report — all locally, ready for a single push when the budget returns. Deep-pass detail
in §10.

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

- **Static browser security foundation** (`src/security/*.js`, 13 test files, **185
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
   → **FIXED: ADR-008 (tie-breaker) + full mechanical sweep across 13 files. 0
   substantive "three-layer" refs remain (git grep); markdownlint 0 errors.**
2. **Superseded issues left open** (#13 ADR-003, #2 MCP-client-webapp) — stale product
   framing presented as live work. → disposition table §5.
3. **Parked reverted addendum** (`agent/browser-reframe-evidence-hardening-20260715`)
   was correct content reverted only for being "unreviewed on main". Risk: good
   corrections silently lost. → **reviewed + re-landed** this session.
4. **Local-dev friction / CI-parity gap.** The toolchain gate demands **exactly Node
   22.23.1 / npm 10.9.8**; Marco's machine runs Node 24 → `toolchain:check` fails
   locally even though tests pass. → **FIXED: `npm run verify:local`** runs the CI
   gates locally with the exact-version gate as advisory (§8/§10).
5. **Stale merged branches** clutter origin (`fix/header-validation-roadmap-refresh`
   =PR#17, `agent/browser-reframe-crossfamily-gates` =PR#22, `feat/cwzl-m0-browser`
   =PR#1). Harmless but noisy; delete needs a push → deferred under freeze.
6. **`feat/cwzl-m0-browser` carries 1–2 possibly-unmerged commits** ("Wissenstransfer
   AllScan→Browser + Compliance-Register-Seed"). Low priority; verify before deleting
   that branch.

---

## 7. What I changed this session (local, not pushed)

Branch `vero/2026-07-16-standalone-reframe-and-report` (all local, not pushed) on top of `3fe912d`:

1. **ADR-008** — browser is standalone; MCP internal/optional — new ADR + README/CHARTER.
2. **Evidence-hardening addendum** re-landed (reviewed, Marco-authored `e74221f`) +
   honest provenance note.
3. **This report** + the readable HTML in `zum Lesen`.
4. **`build(dev)` CI-parity** — `npm run verify:local` + opt-in `.githooks/pre-push`
   (package.json + scripts/verify-local.js + hook).
5. **Full standalone doc sweep** (13 files) — 0 substantive three-layer refs left.
6. **`fix(security)`** — Aegis code fixes: serializeCsp directive-name validation,
   192.0.0.0/24 correction, trailing-dot origin rejection (+6 tests → **185 pass**).
7. **ADR-006/007 enrichment** (Quella primary-source landscape) + **threat-model fix**
   (fetch-class exfil + runtime threat surface) + **MASTER_ROADMAP** runtime alignment.

Verification: **185/185 tests pass**, markdownlint **0 errors** (29 files). One push
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
2. **Local CI parity — BUILT this session.** `npm run verify:local` runs the exact CI
   gates locally (lockfile / CSP / **185 tests** / markdownlint required; exact-Node
   gate advisory since local Node differs; audit `--with-network`). Opt-in
   `.githooks/pre-push` (`git config core.hooksPath .githooks`). Zero cost.
3. **Push without CI when needed:** `[skip ci]` / `[ci skip]` in the commit subject
   skips workflow runs; push to backup/collaborate without burning minutes.
4. **Structural CI-cost cuts (do once, save forever)** — ready patch in §10 / handoff:
   - **path filters** — skip CI for docs-only changes (this repo is ~90 % docs, so this
     alone would have avoided most of the recent burn);
   - `concurrency: cancel-in-progress` **scoped to PRs only** (never cancel `main`);
   - `on: pull_request` to avoid double push+PR runs.
   ⚠️ **Phantom-required-check trap:** a `paths-ignore` on a workflow that later becomes
   a *required* status check (branch protection #18) makes docs-only PRs hang "pending"
   forever. Land path-filters and #18 coherently (details in §10).
5. **Self-hosted runner (structural fix).** Run Actions on Marco's PC — **self-hosted
   minutes are free** (the planned $0.002/min fee was postponed Dec 2025, never took
   effect). Private-repo caveat: harden with runner-groups; never on public repos.
6. **Free tier:** private Free repos include **2,000 Linux Actions-min/month**; the $50
   was overage. Options 3–5 keep us under it sustainably. *(GitHub Billing docs, 2026.)*

**Recommendation:** keep working **local-only** now (1) + **local CI parity** (2, done).
When budget returns: land option 4 (path filters + PR-only, respecting the phantom-check
trap) in the first push; then a **self-hosted runner** (5) to decouple CI from the
budget entirely.

---

## 9. Handoff — clean state for the next person

- **Read first:** this report → `docs/adr/ADR-008` (standalone decision) →
  `docs/IMPLEMENTATION_STATUS.md` + `docs/verification/PRODUCTION_READINESS_MATRIX.md`
  (honest evidence state) → `docs/MASTER_ROADMAP.md`.
- **Truth is standalone:** the doc sweep is done; ADR-008 remains the tie-breaker if
  any provenance-quoted "three-layer stack" wording surfaces.
- **Next real work (in order):** #14 product discovery · ADR-006 runtime spike (#23,
  now grounded by §10 research → measure Electron/CEF) · ADR-007 package spike (#24 →
  Electron + signed Ed25519/Merkle manifest) → then the first **T1 owner-controlled
  offline vertical slice**. Static security is *done enough*; do not add more before the
  runtime exists.
- **Pending (needs a push, deferred under freeze):** batched issue disposition (§5);
  branch cleanup (§6.5); the CI-cost patch (§10) landed coherently with #18.
- **Nothing is lost or broken.** Build is green locally (185 tests); all changes are on
  one reviewable branch awaiting a single push.

---

## 10. Deep-quality pass (2026-07-16) — audit, research, fixes

Marco asked for a maximal-quality pass: critical review, blind spots (incl. positive),
web-researched best solutions. Three specialists ran; findings verified before landing.

### Security audit (Aegis) — no reachable P0

| Sev | Finding | Status |
|---|---|---|
| P1 | Threat-model overclaim: `connect-src` called "the" exfil boundary — **navigation exfil** (`location=`, `window.open`, `<a ping>`) bypasses it; `navigate-to` never shipped / removed from CSP3 | **FIXED** — reworded to "fetch-class" + residual-risk section pointing to ADR-005 runtime navigation allowlist |
| P2 | `serializeCsp` did not validate directive **names** (contained by import gate, but docstring overclaimed) | **FIXED** — name validation + 3 tests |
| P2 | Runtime threat classes (custom-scheme secure-context, SW cross-app leak) not modelled | **FIXED** — new runtime-threat-surface section |
| P2 | Evidence manifest is tamper-**evident**, not tamper-resistant/attested ("immutable" wording) | documented (cosign/SLSA deliberately omitted for private repo — known NR) |
| P3 | `192.0.0.0/16` over-blocked (fail-closed) | **FIXED** — exact `/24` + 2 tests |

**Positive blind spots (better than assumed):** octal/hex/integer-IPv4 and
IPv6-embedded-IPv4 smuggling neutralised; real two-layer separation with an *enforced*
source-scan import gate (tested, not just claimed); CRLF/header-splitting double-closed;
fail-closed throughout; supply-chain above average (SHA-pinned Actions, `permissions:{}`,
`ignore-scripts` triple-enforced, zero runtime deps, secret-scan 0 hits). HSTS is
**exactly** 63072000 at the hardened layer — the "exact two-year" doc claim is true.

### Runtime/package research (Quella, primary-source) → now in ADR-006/007

- **Runtime:** only **bundled Chromium (Electron / CEF)** gives *both* real Chromium
  site-isolation and owner-controlled patch cadence. Adversarial sharpening: WebView2
  *does* inherit Chromium site-isolation — its real disqualifiers for T3 are **no owner
  patch-SLA** (evergreen, MS-controlled) + **platform inconsistency** (WebKit ≠
  site-per-process), not "no isolation". Tauri/system-WebView → T1/own content only.
  Servo/Ladybird not production-ready in 2026 (Ladybird stable ~2028).
- **Isolation:** Chromium default boundary = **site** (scheme + eTLD+1); per-origin needs
  **Origin-Agent-Cluster** (now default). Confirms the addendum's "site ≠ origin".
- **Package:** IWA/`.swbn` is the right *architecture* but 2026 is **Enterprise/ChromeOS
  only** — not portable. Best T1 today = **Electron + own signed Ed25519/Merkle-SHA256
  manifest + OS code-signing** (emulate IWA key-bound identity); watch IWA as the target.
- Honest weak pillars carried forward with low-confidence markers (CEF SLA qualitative;
  Electron "1–2 wk Chromium bump" plausible; asar-integrity/Tauri-updater signing to
  reconfirm before STABLE). ADR-006/007 stay **PROPOSED** — research focuses the spike,
  it does not replace the measured comparison.

### CI-cost cuts — ready patch (apply on first push, respecting the phantom-check trap)

- Free private tier = **2,000 Linux-min/month**; **self-hosted runner = free** (planned
  fee postponed Dec 2025, never active).
- Patch A: `concurrency cancel-in-progress` in docs-ci, PR-scoped. Patch B: `paths` /
  `paths-ignore` (docs vs code) — **only while checks are not required, or via an
  always-runs/conditionally-no-ops gate job once #18 lands** (phantom-check trap). Patch
  C: `on: pull_request` to avoid double runs. End state: self-hosted runner on Marco's PC
  (runner-groups hardened; never public). Full patch text prepared for the push.
