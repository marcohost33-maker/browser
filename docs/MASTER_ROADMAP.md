# `browser` — Master Roadmap v2

- Status: ACTIVE / evidence-gated (product reframed 2026-07-14)
- Updated: 2026-07-14
- Repository: `marcohost33-maker/browser`
- Scope: native, offline-capable browser/webapp **runtime program** (executes
  foreign web apps locally; T1 → T2 → T3; north star **T3**)
- Explicit exclusion: this is **not** `browser-nigin` (the AI layer) and not
  `nigin-engine` (the contract core)

> **PRODUCT REFRAME (2026-07-14) — read first.** Per Marco's 2026-07-14 decision,
> `browser` is a native, offline-capable **runtime program** that runs arbitrary
> foreign web applications locally (staged T1 → T2 → T3; north star **T3**),
> replaces cloud hosting and runs without any AI layer. `browser` is **standalone**
> (ADR-008, 2026-07-16): `nigin-engine` and `browser-nigin` are separate, independent
> repositories linked only by knowledge transfer (not dependencies).
> The binding reframe record is **ADR-005/006/007** (PR #22) — not duplicated here.
> Runtime direction for T3: a Chromium engine (CEF/Electron) is favoured for
> inherited site-isolation and a maintained engine security-patch path over Tauri;
> the framework decision is deferred to the measured comparison in ADR-006. The
> "MCP client webapp / remote endpoint" narrative throughout this roadmap is
> **superseded product framing**; the workstream/gate/evidence *discipline* below
> stays valid and is being re-pointed at the runtime product. Do not read any
> milestone below as a claim of implemented runtime behaviour.

## 1. Production objective

Deliver a native, offline-capable **runtime program** that executes foreign web
applications locally (staged T1 → T2 → T3; north star **T3** = arbitrary foreign
web content), replacing cloud hosting and running without any AI layer. The first
shipping increment is **T1**: run owner-controlled, signed offline packages with a
minimal, auditable attack surface — process/site isolation, per-app data-domain
separation, a default-deny navigation/download/external-protocol policy, an
owner-controlled engine security-patch path, and reproducible build, test, deploy,
monitoring and rollback evidence. MCP consumption is an **internal, optional**
capability off the T1 critical path (ADR-008), **not** a required MCP endpoint.

Four maturity levels are distinct:

1. **Designed** — requirements, decisions and threat models exist.
2. **Implemented** — code exists and passes local checks.
3. **Verified** — CI/manual evidence satisfies acceptance criteria.
4. **Production-ready** — staging, release integrity, operations, rollback and incident exercises pass.

No lower level may be described as a higher one.

## 2. Current verified state

### Merged

- M0 charter, non-goals and APP-01 scope separation.
- ADR-001 architecture boundary and minimal read-only slice.
- ADR-002 contract-artifact signing/provenance design.
- Threat Model, Privacy Model and MCP Consumer Profile.
- Source/standards baseline and open-topics register.
- Machine-readable CSP/security-header baseline.
- Fail-closed CSP serializer, exact-origin `connect-src` allowlist and override/injection protections.
- Documentation CI and security CI.
- Real HTTP-response security-header integration test.
- PR #15 reported 35 passing security tests.

### Implemented on the current hardening branch

- Referrer-Policy value allowlist.
- Permissions-Policy parser requiring powerful M1 features to remain disabled.
- HSTS `includeSubDomains` requirement and duplicate `max-age` rejection.
- Regression tests for all three header-downgrade classes.

### Not yet implemented

- Product-validated primary user and top task.
- Accepted endpoint/trust/deployment architecture.
- Pinned MCP runtime contract and conformance fixtures.
- Actual TypeScript browser application and MCP runtime.
- Browser E2E, privacy sink and full accessibility evaluation.
- SBOM/provenance release pipeline, staging, rollback and incident exercises.

## 3. ADR sequence

Identifiers are unique and immutable:

- **ADR-001** — APP-01 architecture boundary and M1 slice. **SUPERSEDED by ADR-005.**
- **ADR-002** — contract artifact signature and provenance (substance retained; producer-neutral, no external `nigin-engine` producer assumed, ADR-008).
- **ADR-003** — endpoint trust model, browser transport and deployment topology (#13). **SUPERSEDED by ADR-005** (network-security substance retained in `docs/security/*`).
- **ADR-004** — framework/build/browser matrix and PWA decision (#7). *Runtime-framework choice now governed by ADR-006.*
- **ADR-005** — offline runtime trust classes (T1/T2/T3). **Binding reframe record** (PR #22).
- **ADR-006** — runtime evaluation protocol (measured runtime-framework comparison; binding runtime-framework decision) (PR #22).
- **ADR-007** — signed package evaluation gate (PR #22).
- Later decisions use the next free number; identifiers are never reused.

## 4. Critical path

T1-first, no external contract gate (ADR-005/008). Identical to the report
`docs/reports/2026-07-16_STATE_OF_BROWSER_report.md` §4:

```text
#14 product discovery (primary user + one read-only task + go/pivot/stop)
  -> ADR-006 runtime spike (#23)  +  ADR-007 package spike (#24)
  -> secure app/runtime bootstrap
  -> T1 owner-controlled offline vertical slice (run a signed local webapp)
  -> browser / privacy / accessibility / security verification
  -> reproducible build, staging, provenance, rollback + incident gate
  -> narrow release  ... then T2 (curated) ... then T3 (arbitrary foreign content)
```

ADR-003 / #13 (endpoint/trust/deployment) is **no longer on the critical path** —
superseded by ADR-005/008; its network-security substance is retained in
`docs/security/*`. MCP is **off the T1 path** (internal/optional, ADR-008): T1 needs
no MCP endpoint, no remote contract and no external `nigin-engine` artifact.

Static security work may proceed in parallel only when it does not encode an unresolved endpoint, transport or authorization assumption.

## 5. Program workstreams

### WS-0 — Governance and source of truth

Deliverables:

- This master roadmap is canonical for program state.
- `docs/ROADMAP.md` is the short execution view.
- ADR, requirement, risk and claim registers remain synchronized.
- GitHub issues are the source of truth for open implementation work.
- Internal/advisory documents are marked active, superseded or historical.

Gate G0:

- No duplicate ADR identifiers.
- Every P0/P1 item has an owner, dependency and exit criterion.
- No unsupported security/privacy/accessibility claim remains.

### WS-1 — Product discovery (#14)

Research questions:

- Who is the primary user and anti-persona?
- Which one read-only task creates measurable value?
- Why is a new public browser client preferable to existing clients or an internal tool?
- Which data crosses the network and what is the failure cost?

Method:

- Pre-register a falsifiable hypothesis and thresholds.
- Conduct 5–8 structured interviews or documented proxy evaluations.
- Test a task prototype covering endpoint, consent, capability, result and error comprehension.
- Record observations separately from interpretation.
- Include non-adoption evidence and a go/pivot/stop decision.

Gate G1:

- One primary persona, task and measurable success definition.
- Product form and trust class are aligned with ADR-005/008 (runtime product).
- Feature expansion is blocked until the decision is recorded.

### WS-2 — Runtime navigation and network policy (re-scoped from #13 / ADR-003)

> **Re-scoped (ADR-005/008).** The original endpoint/transport architecture (#13 /
> ADR-003) is **superseded** for the runtime product. This workstream is re-pointed
> at the **runtime navigation and network policy**: a **default-deny** navigation,
> popup, download and external-protocol allowlist granted **per app**, plus per-app
> network egress scoping. `connect-src` remains the fetch-class egress control but
> does **not** cover navigation-based exfiltration (see
> `docs/security/THREAT_MODEL.md`, residual-risk note). The CORS/redirect/URL-scheme
> and CSP-feasibility evidence below is retained and re-applied to the runtime's
> per-app network policy rather than to a single remote MCP endpoint.

Evaluate:

- controlled endpoints only;
- arbitrary remote endpoints;
- separate trust tiers;
- backend-for-frontend/gateway mediation.

Required evidence:

- browser CORS/preflight/credential tests;
- CSP `connect-src` feasibility;
- redirect and URL-scheme policy;
- OAuth/no-OAuth/BFF implications;
- threat, privacy, availability and support deltas;
- selected and rejected options with migration triggers.

Gate G2:

- Runtime navigation/network policy accepted (ADR-005/008; supersedes ADR-003).
- Supported trust tier and default-deny egress/navigation surface are explicit.
- No wildcard/scheme-wide CSP fallback.
- Real endpoint integration remains blocked until this gate passes.

### WS-3 — MCP contract and conformance (re-scoped: optional/internal, off T1)

> **Re-scoped (ADR-008).** MCP consumption is an **internal, optional** `browser`
> capability and is **not a prerequisite** for T1. This workstream is **not on the
> T1 critical path**. Any signed contract `browser` chooses to consume may be sourced
> internally or from any signed producer — **no external `nigin-engine` producer is
> assumed**. The ADR-002 signature/provenance-verification discipline below is
> retained but producer-neutral. Execute this workstream only if/when MCP is added,
> after T1.

Required input:

- selected MCP revision and transport profile;
- machine-readable schemas/types with immutable identity;
- initialization/capability/success/negative fixtures;
- deterministic conformance endpoint or command;
- authorization profile or explicit no-OAuth decision;
- timeout, cancellation, payload and disconnect limits;
- compatibility/deprecation and artifact-provenance policy.

APP-01 controls:

- runtime validation at every external boundary;
- endpoint/protocol identity visible to users;
- capability snapshot bound to endpoint, session and contract identity;
- material capability change invalidates consent;
- unsupported mandatory/security-relevant semantics fail closed.

Gate G3:

- CI pins and verifies one contract artifact.
- Positive and negative conformance vectors run deterministically.
- No protocol behavior exists only as APP-01 assumption.

### WS-4 — Stack and application architecture (#7 / ADR-004)

Compare at least a minimal standards-first TypeScript option and one mature framework.

Measure:

- compatibility with the runtime navigation/network policy (ADR-005/008);
- CSP without `unsafe-eval`;
- dependency/transitive dependency count;
- bundle and parse cost;
- accessibility/focus primitives;
- testability and supported browsers;
- build reproducibility, SBOM and maintenance burden.

Spike:

- endpoint form, consent dialog, capability list;
- bounded read-only mock result;
- abort, timeout and error states;
- keyboard-only flow, focus restoration and status announcement.

Gate G4:

- ADR-004 accepted with measured evidence and rejected alternatives.
- PWA/service worker explicitly enabled or deferred.
- Toolchain and browser matrix pinned.

### WS-5 — Secure application foundation (#4)

Deliverables:

- strict TypeScript application boundary;
- deterministic install/build and pinned lockfile;
- lint, format, typecheck, unit, integration and browser E2E harnesses;
- minimum-permission CI and immutable action pins where practical;
- dependency review, secret scan and SAST;
- SPDX/CycloneDX SBOM and SLSA-compatible provenance plan;
- CODEOWNERS, branch protection and release evidence retention.

Existing reusable security foundation:

- CSP/header serializer and validation;
- real HTTP-response header test;
- static self-only `connect-src` enforcement.

Gate G5:

- Clean checkout reproduces the build.
- Required checks protect the default branch.
- CI cannot expose secrets to untrusted contributions.

### WS-6 — Security and adversarial verification (#5, #11, #16)

Threat classes:

- malformed/duplicate/late/out-of-order JSON-RPC;
- capability drift and name collision;
- prompt/tool/resource injection and Unicode obfuscation;
- unsafe HTML/SVG/Markdown and dangerous URL schemes;
- oversized/deep payloads and cancellation races;
- redirect, session replay and cross-session event injection;
- OAuth issuer/audience/state/PKCE failures;
- storage/log/DOM secret canaries;
- header and CSP downgrade attempts.

Gate G6:

- Every P0/P1 threat maps to a control and test.
- Header value and CSP structural downgrade tests pass.
- Runtime exfiltration/injection E2E passes once the application exists.
- No high residual risk lacks an owner and rationale.

### WS-7 — Privacy engineering

Deliverables:

- implementation-derived data-flow diagram and inventory;
- purpose, minimization, retention and deletion per data class;
- no credentials in URL, history, logs or persistent web storage;
- no baseline third-party telemetry, ads, remote fonts or unrelated CDNs;
- sensitive-data sink tests across storage, caches, DOM and diagnostics;
- clear-session/forced-disconnect behavior;
- endpoint/operator responsibility disclosure and accurate Privacy Notice.

Gate G7:

- Network/storage observations match the inventory.
- Secret canaries are absent from prohibited sinks.
- Documentation matches verified behavior.

### WS-8 — Accessibility and interaction quality

Target: WCAG-2.2-AA-oriented critical flow, without claiming formal conformance before a scoped evaluation.

Deliverables:

- native semantic HTML first;
- keyboard operation and no trap;
- visible, ordered and unobscured focus;
- accessible consent/error dialogs and live status;
- contrast, target size, zoom/reflow and reduced motion;
- supported screen-reader/browser smoke matrix.

Gate G8:

- Automated checks have no blocking issue.
- Manual keyboard and assistive-technology scripts pass.
- Primary task works without pointer or vision-dependent cues.

### WS-9 — Vertical product slice (#2)

Flow:

1. Select an allowed endpoint/trust tier.
2. Display endpoint, origin, protocol and privacy boundary.
3. Initialize and negotiate capabilities.
4. Show capabilities as untrusted and disabled by default.
5. Approve one bounded read-only operation with visible arguments.
6. Enforce timeout, abort and size/depth limits.
7. Validate and safely render the result as data.
8. Normalize errors and clear all sensitive session state.

Gate G9:

- Full flow passes happy, error, cancel, privacy, security and accessibility tests against mocks.
- The same contract suite passes against the pinned conformance endpoint.

### WS-10 — Reliability, release and operations (#6)

Define and verify:

- browser support, latency and resource budgets;
- deterministic retry/reconnect policy;
- immutable release artifact, SBOM and provenance;
- staging/production separation and configuration validation;
- SECURITY.md and private vulnerability reporting;
- supported versions and vulnerability SLA;
- privacy-safe monitoring;
- rollback, cache invalidation, session revocation and incident procedures;
- tabletop incident and rollback exercise.

Gate G10:

- Staging deploys the attested artifact.
- Header, smoke, rollback and incident exercises pass.
- No public claim exceeds verified scope.

## 6. Priority model

- **P0:** product/architecture blocker, credential exposure, arbitrary execution, consent bypass, unsafe rendering, contract ambiguity affecting security, release-integrity failure.
- **P1:** major primary-flow privacy, accessibility, reliability or security defect.
- **P2:** secondary hardening, maintainability or performance issue.
- **P3:** optional enhancement.

Work-in-progress limits:

- one unresolved P0 architecture decision at a time;
- one active vertical slice;
- maximum two parallel P1 implementation streams;
- blocked work creates a dependency ticket instead of speculative runtime code.

## 7. Evidence model

```text
REQ/RISK -> ADR/design -> implementation -> test -> evidence artifact -> gate
```

Statuses:

- NOT-TESTED
- FAIL
- PASS-LOCAL
- PASS-CI
- PASS-INDEPENDENT-REVIEW
- ACCEPTED-RISK

A checklist mark without linked evidence is not PASS.

## 8. Empirical work cycle

1. Frame the question and decision owner.
2. State a hypothesis and falsification condition.
3. Select versioned primary sources.
4. Design controlled tests and thresholds.
5. Preserve inputs, commands, environment and raw output.
6. Separate observation, inference, assumption and decision.
7. Seek contradictory evidence and run negative cases.
8. Accept, reject, defer or request more evidence.
9. Implement the smallest reversible change.
10. Verify automatically and manually where needed.
11. Update ADR, requirement, risk and roadmap state.
12. Retrospect on escapes, false positives and process quality.

## 9. Production-ready definition

APP-01 is production-ready only when G0–G10 pass with linked evidence, the selected endpoint and contract boundaries are explicit, no P0 or unowned P1 remains, the primary flow passes against the pinned contract, privacy/accessibility/security claims match observed behavior, and the attested release has exercised rollback and incident procedures.
