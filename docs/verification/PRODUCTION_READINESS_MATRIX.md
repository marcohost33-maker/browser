# APP-01 Production Readiness Matrix

- Status: ACTIVE
- Updated: 2026-07-11
- Scope: `marcohost33-maker/browser`
- Current evidence branch: PR #17

## Status vocabulary

- `NOT-TESTED` — no relevant evidence.
- `BLOCKED` — prerequisite or external artifact missing.
- `FAIL` — tested and acceptance criteria not met.
- `IMPLEMENTED` — change exists but current evidence is incomplete.
- `PASS-CI` — automated evidence passed on the referenced commit.
- `PASS-MANUAL` — required manual evaluation passed with records.
- `PASS-INDEPENDENT-REVIEW` — reviewed by a qualified separate reviewer.
- `ACCEPTED-RISK` — explicit owner, rationale, expiry and compensating controls.

A document, checklist mark or prior green commit does not prove a later commit.
Production requires the relevant matrix rows to reference evidence from the
release candidate.

## G0 — Scope and governance

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| GOV-01 | APP-01 scope excludes ENG-01/browser-nigin platform work | PASS-CI (PR #17) | Charter, README, docs CI |
| GOV-02 | Unique accepted ADR sequence and active decision register | PASS-CI (PR #17) | ADR-001/002, ADR-003 proposal, OPEN_DECISIONS |
| GOV-03 | Critical paths have code owners | IMPLEMENTED (PR #17) | `.github/CODEOWNERS`; enforcement requires ruleset |
| GOV-04 | Default branch requires PR, required checks, code-owner review and resolved conversations | FAIL / OPEN | Direct `main` write was possible; configure repository ruleset |
| GOV-05 | Vulnerability disclosure and response policy | IMPLEMENTED (PR #17) | `SECURITY.md`; verify private reporting is enabled |
| GOV-06 | Public claims match verified maturity | PASS-CI (PR #17) | README and implementation status prohibit production claim |

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
| END-02 | Full endpoint URL and canonical CSP origin separated | IMPLEMENTED (design + policy) | ADR-003; CLI approved-origin tests |
| END-03 | Production origins HTTPS; HTTP loopback only | PASS-CI (PR #17) | origin validator and negative tests |
| END-04 | Representative endpoint passes browser CORS profile | NOT-TESTED | preflight/method/header/credential evidence required |
| END-05 | Redirect/private-network/DNS policy tested | NOT-TESTED | ADR-003 spike |
| AUTH-01 | Explicit no-OAuth or accepted OAuth profile | BLOCKED | ENG-01 contract + ADR-003 |
| AUTH-02 | PKCE, redirect, issuer/state and audience controls verified when OAuth enabled | BLOCKED | no OAuth implementation |

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
| BUILD-01 | Deterministic install with lockfile and lifecycle scripts disabled | PASS-CI (PR #17) | `npm ci --ignore-scripts` |
| BUILD-02 | Supported Node version fixed | PASS-CI (PR #17) | Node 22 workflow and package engines |
| BUILD-03 | Strict TypeScript application bootstrap | NOT-TESTED | ADR-004 required first |
| BUILD-04 | Lint, format, typecheck, unit, integration and browser E2E | BLOCKED | runtime/toolchain absent |
| BUILD-05 | Dependency updates use review and release cooldown | IMPLEMENTED (PR #17) | Dependabot config; verify first run |
| BUILD-06 | Workflow actions immutable and least privilege | PASS-CI (PR #17) | zizmor workflow audit |
| BUILD-07 | Secret scanning, dependency review and applicable SAST | NOT-TESTED | repository feature/workflow configuration open |

## G5 — Static browser security foundation

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| SEC-01 | CSP generated from one machine-readable baseline | PASS-CI (PR #17) | serializer and response tests |
| SEC-02 | Exact-origin `connect-src`; no wildcard/scheme widening | PASS-CI (PR #17) | positive/negative policy tests |
| SEC-03 | CSP override/source/header injection blocked | PASS-CI (PR #17) | Aegis regression fixtures |
| SEC-04 | Complete required M1 security-header set | PASS-CI (PR #17) | hardened validator and served response |
| SEC-05 | Header casing, duplicates and weak values fail closed | PASS-CI (PR #17) | review regressions and header tests |
| SEC-06 | Endpoint origins and app-response CORS trust directions separated | PASS-CI (PR #17) | ACAO forbidden in hardened app profile |
| SEC-07 | Browser demonstrates unapproved exfiltration is blocked | BLOCKED | real app/E2E absent |

## G6 — Runtime security, privacy and reliability

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| RUN-01 | UI cannot call transport directly | BLOCKED | runtime absent; ADR-001 accepted |
| RUN-02 | External MCP messages runtime-validated | BLOCKED | contract/runtime absent |
| RUN-03 | Capability consent bound to endpoint/session/contract snapshot | BLOCKED | runtime absent |
| RUN-04 | Timeout, abort, byte/depth/item/render limits | BLOCKED | runtime absent |
| RUN-05 | Safe rendering of hostile text/Markdown/URLs | BLOCKED | runtime absent |
| RUN-06 | Retry/reconnect/session behavior deterministic | BLOCKED | endpoint/contract/runtime absent |
| PRIV-01 | Data-flow inventory derived from implementation | BLOCKED | runtime absent |
| PRIV-02 | No sensitive canary in storage, URL, history, DOM, logs or diagnostics | BLOCKED | browser sink test absent |
| PRIV-03 | Clear-session and forced disconnect verified | BLOCKED | runtime absent |
| PRIV-04 | Privacy Notice matches observed behavior | BLOCKED | implementation/data flow absent |

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
| SUP-01 | SPDX or CycloneDX SBOM generated for candidate | PASS-CI (PR #17 foundation) | SPDX workflow artifact; completeness review still open |
| SUP-02 | Release artifact provenance/attestation | BLOCKED | release build absent |
| SUP-03 | Reproducible candidate build and digest comparison | BLOCKED | application build absent |
| SUP-04 | Contract provenance verified before trust | BLOCKED | ENG-01 artifact/verifier absent |
| LEGAL-01 | Repository license explicit | IMPLEMENTED (PR #17) | MIT LICENSE |
| LEGAL-02 | Third-party notices/license review | BLOCKED | final dependency graph absent |

## G9 — Deployment and operations

| ID | Requirement | Current status | Evidence / blocker |
|---|---|---|---|
| OPS-01 | Staging/production separation and config validation | BLOCKED | deployment absent |
| OPS-02 | Security headers verified at deployed edge | BLOCKED | deployment absent |
| OPS-03 | Privacy-safe monitoring and support ownership | BLOCKED | product/deployment decision absent |
| OPS-04 | Rollback and cache invalidation exercised | BLOCKED | release/deployment absent |
| OPS-05 | Credential/session revocation procedure | BLOCKED | auth/runtime absent |
| OPS-06 | Incident tabletop and contact path tested | NOT-TESTED | SECURITY.md foundation only |

## Production gate

APP-01 may be described as production-ready only when:

- all P0 rows pass or have explicit non-expired accepted risk;
- no P1 row is unowned;
- release-candidate evidence is from the same commit/artifact;
- product, endpoint and contract gates are accepted;
- runtime, privacy, accessibility, supply-chain and operational gates pass;
- staging deploys the attested artifact and rollback has been exercised.

Current conclusion: **NOT PRODUCTION-READY**. The repository foundation is being
hardened, but product, runtime, contract, accessibility and operations remain
materially incomplete.
