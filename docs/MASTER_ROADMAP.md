# APP-01 `browser` — Master Roadmap

- Status: WORKING / evidence-gated
- Date: 2026-07-10
- Scope: public privacy-first MCP client webapp
- Contract owner: ENG-01 `nigin-engine`
- Governing principle: no production claim without executable evidence

## 1. Objective

Deliver a public, accessible, privacy-first MCP client webapp that consumes a versioned ENG-01 contract, exposes only explicitly approved capabilities, fails closed under ambiguity, and can be built, tested, released, monitored, rolled back and supported with reproducible evidence.

This roadmap separates four maturity claims:

1. **Designed** — requirements, threat model and decisions exist.
2. **Implemented** — code exists and passes local checks.
3. **Verified** — automated and manual evidence satisfies acceptance criteria.
4. **Production-ready** — deployment, operations, incident response and rollback are exercised.

No lower level may be presented as a higher one.

## 2. Current verified state

- M0 scope and repo boundary are documented.
- PR #3 merged architecture, privacy, threat and consumer-profile foundations.
- Issues #2 and #4–#7 describe the vertical slice, bootstrap, adversarial corpus, operations and architecture spike.
- ENG-01 issue #3 requests the pinned MCP contract and conformance kit.
- No production application, deployment, CI evidence or conformance result exists yet.

## 3. Critical path

```text
Governance baseline
  -> ENG-01 contract/conformance kit
  -> architecture spike + ADR-002
  -> secure project bootstrap
  -> mock-based vertical slice
  -> hostile fixture corpus
  -> real ENG-01 adapter
  -> verification matrix complete
  -> release candidate
  -> operational/tabletop gate
  -> public production release
```

Parallel work is allowed only where it cannot encode unverified protocol assumptions.

## 4. Program workstreams

### WS-0 — Governance, source of truth and decision control

**Goal:** prevent contradictory roadmaps, silent scope drift and unsupported claims.

Deliverables:

- Canonical master roadmap and subordinate roadmaps.
- Decision register with ADR state: proposed, accepted, superseded, rejected.
- Requirement IDs and bidirectional traceability to code, tests and evidence.
- Risk register with owner, likelihood, impact, control and residual risk.
- Claim register for security, privacy, accessibility and compatibility statements.
- Source hierarchy: normative specification > accepted ADR > contract artifact > tests/evidence > advisory research.
- Supersession rule for internal Drive documents.

Exit gate G0:

- One canonical roadmap is named.
- Every open issue maps to a workstream and milestone.
- Conflicting internal documents are marked advisory, superseded or unresolved.
- No orphan P0/P1 item remains.

### WS-1 — Product and user-outcome research

**Research questions:**

- Who is the first real user and what task requires APP-01 instead of a generic MCP host?
- Which single read-only outcome proves product value without write privileges?
- Which endpoint classes are supported: hosted ENG-01 only, arbitrary remote MCP, or both?
- Is APP-01 a standalone site, embeddable client, installable PWA or later all three?
- What data must cross the network for the first task?

Method:

- Define primary persona and anti-persona.
- Write top task, misuse cases and non-goals.
- Conduct 5–8 structured task interviews or proxy reviews before broadening scope.
- Use a clickable/mock prototype for comprehension, consent and error-state tests.
- Record hypotheses, observations, decision thresholds and contradictory evidence.

Exit gate G1:

- One primary use case with measurable success criteria.
- At least one falsifiable value hypothesis.
- No unresolved ambiguity about arbitrary endpoints versus controlled ENG-01 endpoints.

### WS-2 — ENG-01 contract and protocol conformance

Owner dependency: `nigin-engine#3`.

Required artifact set:

- Pinned MCP protocol version and transport profile.
- Immutable digest/version for schemas and generated types.
- Initialization, capability, success and negative fixtures.
- Deterministic conformance server or command.
- Authorization profile or explicit no-OAuth M1 decision.
- Timeout, cancellation, payload and disconnect limits.
- Compatibility/deprecation policy.
- Artifact integrity/provenance statement.

APP-01 controls:

- Runtime validation at every external boundary.
- Endpoint identity and negotiated protocol visible to users.
- Capability snapshot bound to endpoint identity, session and contract digest.
- Material capability changes invalidate consent.
- Unknown mandatory semantics fail closed.

Exit gate G2:

- APP-01 CI can pin and verify one ENG-01 artifact.
- Positive and negative conformance vectors execute deterministically.
- No protocol behavior is defined only in APP-01 code or prose.

### WS-3 — Architecture and technology selection

Issue: `browser#7`.

Compare at least:

- standards-first/minimal TypeScript application;
- one mature component framework.

Measured criteria:

- strict CSP compatibility without `unsafe-eval`;
- dependency and transitive dependency count;
- production bundle size and parse cost;
- accessibility primitives and focus behavior;
- testing ergonomics;
- browser support;
- security update cadence;
- build reproducibility;
- SBOM quality;
- reversibility and migration cost.

Spike features:

- endpoint form;
- consent dialog;
- capability list;
- read-only mock request;
- abort, timeout and failure states;
- keyboard-only operation;
- focus restoration and live status announcement.

Exit gate G3:

- ADR-002 accepted with measured evidence.
- Deployment topology and connection model are explicit.
- PWA/service worker remains disabled unless separately justified.

### WS-4 — Secure software foundation

Issue: `browser#4`.

Deliverables:

- Strict TypeScript configuration.
- Pinned runtime/toolchain and lockfile.
- Deterministic install and build commands.
- Formatting, linting, typecheck and tests.
- Unit, component/integration and browser E2E harnesses.
- Code ownership and review rules.
- Minimal-permission CI workflows pinned to immutable action SHAs where practical.
- Dependency review, secret scanning and SAST.
- SPDX or CycloneDX SBOM plus completeness sanity check.
- Build provenance/attestation and checksummed release artifact.

Exit gate G4:

- Clean checkout reproduces the build.
- All checks are required branch protections.
- CI has least privilege and no untrusted secret exposure.
- Evidence artifacts are retained and linked from the release candidate.

### WS-5 — Security architecture and adversarial validation

Issues: `browser#5`, threat model merged in PR #3.

Control domains:

- endpoint validation and identity;
- consent and capability policy;
- prompt/tool/resource content isolation;
- OAuth and token handling;
- session binding and replay resistance;
- request limits, timeout, cancellation and backpressure;
- safe rendering and URL policy;
- browser storage and diagnostics hygiene;
- supply chain and release integrity.

Adversarial corpus:

- malformed, duplicate, late, mismatched and out-of-order JSON-RPC;
- capability drift and name collision;
- instruction injection and Unicode controls;
- unsafe HTML/SVG/Markdown and dangerous URL schemes;
- oversized/deep payloads;
- redirect chains and internal targets;
- replay/cross-session events;
- authorization issuer/audience/state/PKCE failures;
- canary secrets checked across all prohibited sinks.

Exit gate G5:

- Every P0/P1 threat maps to prevention/detection and an automated or documented manual test.
- No high residual risk is accepted without named owner and rationale.
- Fuzz/property-based testing covers parsers and boundary validators where useful.

### WS-6 — Privacy engineering

Deliverables:

- Data-flow diagram and inventory.
- Purpose, minimization, retention and deletion rule per data class.
- Memory-only credential handling for M1.
- No third-party telemetry, ads, remote fonts or unrelated CDNs in baseline.
- Sensitive-data sink test across localStorage, sessionStorage, IndexedDB, Cache Storage, URL/history, DOM snapshots, console and exported diagnostics.
- Clear-session and forced-disconnect behavior.
- Endpoint/operator responsibility disclosure.
- Privacy notice generated from actual implementation, not aspirations.

Exit gate G6:

- Data-flow inventory matches network and storage observations.
- Sensitive canaries are absent from all prohibited sinks.
- Privacy notice and UI disclosures match verified behavior.

### WS-7 — Accessibility and inclusive interaction

Target: WCAG 2.2 AA baseline, with manual validation for interaction-critical criteria.

Deliverables:

- semantic structure and labels;
- keyboard operation and no keyboard trap;
- predictable focus order, visible focus and focus not obscured;
- accessible consent and error dialogs;
- status announcements for connection, progress, cancellation and errors;
- sufficient target sizes and contrast;
- zoom/reflow and reduced-motion behavior;
- screen-reader smoke tests on supported platform combinations;
- accessibility statement with known limitations.

Exit gate G7:

- Automated checks have no blocking violations.
- Manual keyboard and screen-reader scripts pass.
- Critical user flow is operable without pointer or vision-dependent cues.

### WS-8 — Vertical product slice

Issue: `browser#2`.

M1 slice:

1. User enters or selects an allowed endpoint.
2. Client displays endpoint identity and privacy boundary.
3. Client initializes and negotiates capabilities.
4. Capabilities are shown as untrusted, disabled by default.
5. User approves one bounded read-only operation with visible arguments.
6. Request can be cancelled and times out.
7. Result is validated, size-bounded and safely rendered as data.
8. Errors are normalized and actionable.
9. Disconnect/clear-session removes sensitive state.

Non-goals:

- write tools;
- autonomous loops;
- sampling/elicitation unless separately approved;
- local command/server installation;
- universal browser or marketplace;
- service-worker caching of sensitive content.

Exit gate G8:

- Full slice passes happy, failure, cancellation, privacy, security and accessibility tests with mock server.
- Same suite passes against ENG-01 conformance endpoint before release.

### WS-9 — Reliability, performance and compatibility

Define service and client objectives before optimization:

- supported browser matrix;
- maximum initialization latency;
- request timeout defaults and allowed range;
- maximum response bytes, item count and nesting depth;
- memory ceiling for representative flows;
- deterministic error/retry policy;
- no automatic retry for non-idempotent operations;
- offline behavior as explicit unavailable state in M1.

Tests:

- network interruption and reconnect;
- slow/partial responses;
- cancellation races;
- repeated connect/disconnect leak test;
- browser compatibility matrix;
- bundle and runtime performance budget.

Exit gate G9:

- SLOs and budgets are measured in CI or release testing.
- No unresolved resource leak or unbounded retry path.

### WS-10 — Release, deployment and operations

Issue: `browser#6`.

Deliverables:

- production hosting/deployment architecture;
- enforced CSP, HSTS, Referrer-Policy, Permissions-Policy, nosniff and frame policy;
- environment separation and configuration validation;
- immutable release artifact and deployment provenance;
- rollback and cache invalidation procedure;
- SECURITY.md and private vulnerability reporting;
- supported-version policy and vulnerability triage SLA;
- incident severity, response and communication plan;
- credential/session revocation and forced disconnect;
- privacy-safe monitoring and CSP-report policy;
- backup/recovery only for data actually retained;
- tabletop incident and rollback exercise.

Exit gate G10:

- Release candidate deployed to staging from the attested artifact.
- Header, smoke, rollback and incident exercises pass.
- No unsupported public claims remain.

## 5. Milestone roadmap

### M0 — Scope and governance

Complete when G0 passes. The merged PR #3 satisfies part of this baseline.

### M1 — Research and contract readiness

Contains WS-1, WS-2 and initial WS-3. Output is a validated use case, contract kit and accepted stack decision.

### M2 — Secure foundation

Contains WS-4 plus initial WS-5/6/7 automation. No real privileged capability required.

### M3 — Mock vertical slice

Implements WS-8 against deterministic mocks and hostile fixtures.

### M4 — ENG-01 integration

Replaces the mock adapter through the same port, executes conformance and compatibility tests, and proves no protocol logic leaked into UI/application layers.

### M5 — Release candidate

Completes G5–G9, creates SBOM/provenance and deploys a staging candidate.

### M6 — Production readiness

Completes G10, operational exercises, claim review and owner sign-off.

### M7 — Public release and monitored learning

Release narrowly, observe predefined signals, review incidents/feedback, and decide whether OAuth, saved endpoints, PWA, write tools or broader MCP compatibility deserve separate post-M1 ADRs.

## 6. Prioritization

Use severity and dependency, not enthusiasm:

- **P0:** credential exposure, arbitrary execution, consent bypass, contract ambiguity affecting security, unsafe rendering, release integrity failure.
- **P1:** major privacy/accessibility/reliability failure in the primary flow.
- **P2:** maintainability, performance or secondary UX issue.
- **P3:** optional enhancement.

Work-in-progress limits:

- one active architecture decision;
- one active vertical slice;
- no more than two parallel P1 implementation streams;
- blocked work must produce an explicit dependency ticket, not speculative code.

## 7. Evidence model

Each requirement uses:

```text
REQ-ID -> design/ADR -> implementation -> test -> evidence artifact -> release gate
```

Evidence statuses:

- NOT-TESTED
- FAIL
- PASS-LOCAL
- PASS-CI
- PASS-INDEPENDENT-REVIEW
- ACCEPTED-RISK

A checklist tick without linked evidence is not PASS.

## 8. Professional empirical workflow

For each research or engineering question:

1. **Frame:** precise question, scope, decision owner and trigger.
2. **Hypothesize:** expected result and falsification condition.
3. **Source:** normative and primary sources first; record versions and dates.
4. **Design:** experiment/test with controls, fixtures and acceptance threshold.
5. **Execute:** preserve commands, inputs, environment and raw output.
6. **Analyze:** separate observation, inference, assumption and decision.
7. **Falsify:** run negative cases and seek contradictory evidence.
8. **Adjudicate:** accept, reject, defer or request more evidence.
9. **Implement:** smallest reversible change behind a clear boundary.
10. **Verify:** automated evidence plus manual review where automation is insufficient.
11. **Record:** update ADR, risk, requirement and roadmap status.
12. **Retrospect:** examine escapes, false positives, cycle time and process improvements.

## 9. Metrics

Track trends, not vanity totals:

- requirement-to-evidence coverage;
- P0/P1 open age;
- escaped defect rate;
- change failure and rollback rate;
- mean time to detect/resolve security issues;
- conformance pass rate by contract version;
- flaky test rate;
- accessibility critical-flow pass rate;
- sensitive-data sink violations;
- build reproducibility rate;
- dependency age and known-vulnerability exposure window;
- user task completion and consent comprehension.

## 10. Final production definition

APP-01 is production-ready only when all of the following are true:

- G0–G10 pass with linked evidence.
- Contract and endpoint trust boundaries are explicit.
- Primary flow works against the pinned ENG-01 contract.
- No P0 or unowned P1 risk remains.
- Privacy, accessibility, security and reliability claims match observed behavior.
- Release is reproducible, attested, rollback-capable and operationally owned.
- Incident and vulnerability procedures have been exercised.
- Public scope remains narrower than the verified capability set.