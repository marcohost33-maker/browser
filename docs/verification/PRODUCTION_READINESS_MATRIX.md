# APP-01 Production Readiness Matrix

- Status: ACTIVE
- Updated: 2026-07-12
- Scope: `marcohost33-maker/browser`
- Current evidence branch: Draft PR #17

## Status vocabulary

- `NOT-TESTED` — no relevant evidence.
- `BLOCKED` — prerequisite or external artifact missing.
- `FAIL` — tested and acceptance criteria not met.
- `IMPLEMENTED` — change exists but exact-candidate evidence is incomplete.
- `PASS-CI` — automated evidence passed on the referenced commit.
- `PASS-MANUAL` — required manual evaluation passed with records.
- `PASS-INDEPENDENT-REVIEW` — reviewed by a qualified separate reviewer.
- `ACCEPTED-RISK` — explicit owner, rationale, expiry and compensating controls.

A document, checklist mark or prior green commit does not prove a later commit.
Production requires the relevant rows to reference evidence from the exact release
candidate, built artifact and deployed instance.

## G0 — Scope and governance

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| GOV-01 | APP-01 scope excludes ENG-01/browser-nigin platform work | PASS-CI (PR #17) | Charter, README, docs CI |
| GOV-02 | Unique accepted ADR sequence and active decision register | PASS-CI (PR #17) | ADR-001/002, ADR-003 proposal, OPEN_DECISIONS |
| GOV-03 | Critical paths have code owners | IMPLEMENTED (PR #17) | `.github/CODEOWNERS`; enforcement requires #18 |
| GOV-04 | Default branch requires PR, required checks, independent/code-owner review and resolved conversations | FAIL / OPEN | Direct `main` write was possible; #18 |
| GOV-05 | Vulnerability disclosure and response policy | IMPLEMENTED (PR #17) | `SECURITY.md`; private-reporting setting not verified |
| GOV-06 | Public claims match verified maturity | PASS-CI (PR #17) | README/status/matrix prohibit production claim |
| GOV-07 | Exact final head has independent review after the latest security changes | BLOCKED | #20; automated/self-review is not independent approval |

## G1 — Product evidence

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| PROD-01 | Primary persona and anti-persona selected | NOT-TESTED | Issue #14 protocol ready |
| PROD-02 | One bounded read-only top task selected | NOT-TESTED | Issue #14 |
| PROD-03 | Falsifiable thresholds pre-registered | NOT-TESTED | `docs/research/PRODUCT_DISCOVERY_PROTOCOL.md` |
| PROD-04 | Interviews/task study include contradictory evidence | NOT-TESTED | 5–8 sessions or justified proxy evidence required |
| PROD-05 | Go/pivot/stop decision recorded | BLOCKED | Depends on PROD-01–04 |

## G2 — Endpoint, transport and authorization architecture

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| END-01 | Supported endpoint class and trust tier accepted | BLOCKED | ADR-003 proposed; #13 open |
| END-02 | Full endpoint URL and canonical CSP origin separated | IMPLEMENTED (design + policy) | ADR-003; CLI/origin tests |
| END-03 | Static origin gate rejects plaintext remote, localhost misuse and non-public/reserved address literals | PASS-CI (PR #17) | exact-origin and mapped-address regressions |
| END-04 | Representative endpoint passes browser CORS profile | NOT-TESTED | preflight/method/header/credential evidence required |
| END-05 | Redirect, DNS rebinding, resolved private-network and metadata-service policy tested | NOT-TESTED | string validation cannot prove runtime resolution; ADR-003 spike |
| AUTH-01 | Explicit no-OAuth or accepted OAuth profile | BLOCKED | ENG-01 contract + ADR-003 |
| AUTH-02 | PKCE, redirect, issuer/state/audience and popup/isolation compatibility verified when OAuth enabled | BLOCKED | no OAuth implementation; COOP compatibility open |

## G3 — MCP contract and conformance

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| MCP-01 | MCP revision and transport profile pinned | BLOCKED | ENG-01 artifact absent |
| MCP-02 | Signed artifact, Sigstore bundle, provenance and digest lock | BLOCKED | ADR-002 accepted target design; producer artifact absent |
| MCP-03 | Signature identity/provenance verifier implemented | NOT-TESTED | future workflow |
| MCP-04 | Positive/negative fixtures and deterministic conformance | BLOCKED | ENG-01 input absent |
| MCP-05 | Compatibility/deprecation policy | BLOCKED | contract publication |

## G4 — Repository and build foundation

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| BUILD-01 | Frozen lockfile, exact direct tools, integrity digests, fixed public registry and lifecycle scripts disabled | PASS-CI (PR #17) | `.npmrc`, lockfile invariant gate, `npm ci --ignore-scripts` |
| BUILD-02 | Exact Node/npm versions and Linux runner family enforced in evidence workflows | PASS-CI (PR #17) | Node 22.23.1, npm 10.9.8, `ubuntu-24.04`; hosted image patch remains external |
| BUILD-03 | Strict TypeScript application bootstrap | NOT-TESTED | ADR-004 required first |
| BUILD-04 | Lint, format, typecheck, unit, integration and browser E2E | BLOCKED | application runtime/toolchain absent |
| BUILD-05 | Dependency updates use review and release cooldown | IMPLEMENTED (PR #17) | Dependabot config; first update cycle not verified |
| BUILD-06 | Workflow actions immutable and least privilege | PASS-CI (PR #17) | SHA pins and zizmor audit |
| BUILD-07 | Current tooling graph has machine-readable vulnerability evidence and high/critical gate | PASS-CI (PR #17 foundation) | archived `npm-audit.json`; final application graph absent |
| BUILD-08 | Secret scanning, dependency review and applicable SAST configured | NOT-TESTED | repository feature/workflow configuration open |

## G5 — Static browser security foundation

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| SEC-01 | One emitted-value baseline plus independent exact contract and validated metadata prevent silent drift | PASS-CI (PR #17) | baseline, metadata, directive and policy regressions |
| SEC-02 | Exact-origin `connect-src`; no wildcard, scheme or non-public-literal widening | PASS-CI (PR #17) | positive/negative origin and policy tests |
| SEC-03 | CSP override, source/header injection and raw source-level bypass blocked | PASS-CI (PR #17) | Aegis fixtures and entry-point import gate |
| SEC-04 | Reviewed M1 static header contract present and fail closed | PASS-CI (PR #17) | hardened validator; not a universal browser-policy claim |
| SEC-05 | Exact two-year HSTS, exact `no-referrer`, canonical Permissions-Policy and strict isolation values enforced | PASS-CI (PR #17) | downgrade, ordering and serialization regressions |
| SEC-06 | Endpoint origins and every app-response `Access-Control-*` trust direction separated | PASS-CI (PR #17) | final-response gate rejects CORS headers |
| SEC-07 | Final in-process response preserves protected headers and rejects reporting, cookie and disclosure extras | PASS-CI (PR #17) | response-map and forbidden-header tests |
| SEC-08 | Deployed edge and supported browsers preserve/enforce headers | BLOCKED | staging/CDN/raw-wire/browser E2E absent |
| SEC-09 | Unapproved browser exfiltration is empirically blocked | BLOCKED | real app/E2E absent |
| SEC-10 | Permissions-Policy, COOP and COEP compatibility verified across supported browsers/auth flows | BLOCKED | ADR-003/ADR-004 and runtime absent |
| SEC-11 | Provisional form, data-image, font, manifest and worker capabilities are removed or justified individually | BLOCKED | ADR-004 remove-unless-proven capability budget |

## G6 — Runtime security, privacy and reliability

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| RUN-01 | UI cannot call transport directly | BLOCKED | runtime absent; ADR-001 accepted |
| RUN-02 | External MCP messages runtime-validated | BLOCKED | contract/runtime absent |
| RUN-03 | Capability consent bound to endpoint/session/contract snapshot | BLOCKED | runtime absent |
| RUN-04 | Timeout, abort, byte/depth/item/render limits | BLOCKED | runtime absent |
| RUN-05 | Safe rendering of hostile text/Markdown/URLs | BLOCKED | runtime absent |
| RUN-06 | Retry/reconnect/session behavior deterministic | BLOCKED | endpoint/contract/runtime absent |
| RUN-07 | Token passthrough prohibited; audience and endpoint binding verified | BLOCKED | auth/runtime absent |
| PRIV-01 | Data-flow inventory derived from implementation | BLOCKED | runtime absent |
| PRIV-02 | No sensitive canary in storage, URL, history, DOM, logs or diagnostics | BLOCKED | browser sink test absent |
| PRIV-03 | Clear-session and forced disconnect verified | BLOCKED | runtime absent |
| PRIV-04 | Privacy Notice matches observed behavior | BLOCKED | implementation/data flow absent |
| PRIV-05 | Browser reporting/telemetry endpoints have explicit data-minimization decision | BLOCKED | M1 forbids reporting headers; future monitoring requires privacy review |

## G7 — Accessibility and interaction quality

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| A11Y-01 | Native semantics and accessible names | BLOCKED | UI absent |
| A11Y-02 | Full keyboard flow, no trap, focus restore/visibility | BLOCKED | UI absent |
| A11Y-03 | Status/error/consent announcements | BLOCKED | UI absent |
| A11Y-04 | Zoom/reflow, contrast, targets and reduced motion | BLOCKED | UI absent |
| A11Y-05 | Supported browser/screen-reader manual matrix | BLOCKED | ADR-004/UI absent |
| A11Y-06 | Public conformance claim supported by scoped evaluation | NOT-TESTED | no claim permitted yet |

## G8 — Supply chain and release evidence

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| SUP-01 | SPDX SBOM generated and structurally validated for current source/tool graph | PASS-CI (PR #17 foundation) | immutable artifact; final application completeness open |
| SUP-02 | Evidence manifest binds source/tested SHA, tools, registry, runner facts and package/lock/npmrc/audit/SBOM digests | PASS-CI (PR #17 foundation) | security evidence schema 1.2, 90-day artifact |
| SUP-03 | Release artifact provenance/attestation | BLOCKED | release build absent |
| SUP-04 | Bit-for-bit reproducible candidate build and independent digest comparison | BLOCKED | hosted image, live advisory DB, timestamps and application build remain uncontrolled |
| SUP-05 | Contract provenance verified before trust | BLOCKED | ENG-01 artifact/verifier absent |
| SUP-06 | Dependency licenses/notices reviewed against exact release graph | BLOCKED | final application graph absent |
| LEGAL-01 | Repository license explicit | IMPLEMENTED (PR #17) | MIT LICENSE |

## G9 — Deployment and operations

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| OPS-01 | Staging/production separation and config validation | BLOCKED | deployment absent |
| OPS-02 | Security headers verified after all middleware/CDN/edge transformations using raw-wire capture | BLOCKED | deployment absent |
| OPS-03 | Privacy-safe monitoring and support ownership | BLOCKED | product/deployment decision absent; reporting currently forbidden |
| OPS-04 | Rollback and cache invalidation exercised | BLOCKED | release/deployment absent |
| OPS-05 | Credential/session revocation procedure | BLOCKED | auth/runtime absent |
| OPS-06 | Incident tabletop and contact path tested | NOT-TESTED | SECURITY.md foundation only |
| OPS-07 | HSTS subdomain inventory and any preload enrollment/removal plan accepted | BLOCKED | preload deliberately rejected by M1 policy |
| OPS-08 | Service-worker/PWA cache, update, persistence and emergency-removal strategy accepted if enabled | BLOCKED | ADR-004 capability decision open |

## Production gate

APP-01 may be described as production-ready only when:

- all P0 rows pass or have explicit non-expired accepted risk;
- no P1 row is unowned;
- independent review covers the final candidate head;
- release evidence is from the same commit and artifact;
- product, endpoint and contract gates are accepted;
- runtime, privacy, accessibility, supply-chain and operational gates pass;
- staging deploys the attested artifact and rollback has been exercised.

Current conclusion: **NOT PRODUCTION-READY**. The static repository/security and
traceability foundation is substantially hardened, but governance enforcement,
product, contract, runtime, deployed browser behavior, accessibility, release
reproducibility and operations remain materially incomplete.
