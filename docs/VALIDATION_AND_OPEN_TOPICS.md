# Validation, Falsification and Open Topics Register

- Date: 2026-07-10
- Scope: last two browser hardening responses, merged PR #3, browser issues #2/#4–#7 and nigin-engine#3
- Status: canonical working register until superseded

## 1. Validation verdict

### Confirmed strengths

- APP-01 is correctly separated from ENG-01 contract ownership.
- Deferring real MCP integration until a pinned contract exists is correct.
- The first production slice should remain read-only, explicit-consent and bounded.
- Threat, privacy and consumer-profile documents are appropriate M0/M1 foundation artifacts.
- Security, accessibility, supply-chain and operational readiness must be evidence gates, not prose-only claims.

### Falsified or corrected claims

1. **"Production-ready level" was not achieved.** Only design and planning artifacts existed; implementation, CI, conformance, deployment and operational evidence were absent.
2. **Capability negotiation is not capability trust.** Negotiated metadata remains untrusted; identity, integrity, policy and consent binding are separate controls.
3. **An SBOM alone is not sufficient supply-chain evidence.** Completeness, provenance, pinned dependencies and vulnerability handling are also required.
4. **Automated accessibility scans are not WCAG conformance.** Manual keyboard, focus and assistive-technology testing is necessary.
5. **A CSP example cannot be finalized before deployment topology and endpoint policy are decided.** `connect-src`, worker and embedding rules depend on architecture.
6. **Memory-only credentials do not by themselves make browser OAuth safe.** Redirect, issuer, audience, PKCE/state, refresh behavior and XSS resistance remain required.
7. **A roadmap checkbox is not evidence.** Each gate requires linked test or reviewed artifact.

## 2. Contradictions and unresolved architecture questions

### OT-01 Contract ownership and neutral platform boundary

Internal material recommends reconsidering a neutral `nigin-platform` when multiple independent consumers or release cycles exist. Current repo mapping names `nigin-engine` as contract owner. This is acceptable as an interim decision, not necessarily the permanent architecture.

Decision trigger:

- second independent consumer;
- independent contract release cadence;
- external adapter/partner;
- evidence that engine-specific assumptions contaminate the contract.

Required action: record an explicit ENG-01 ADR stating interim ownership and extraction triggers.

### OT-02 Endpoint model

Unresolved:

- only controlled ENG-01 endpoints;
- arbitrary remote MCP endpoints;
- both through separate trust tiers.

This decision affects CSP, authorization, privacy notice, support model, SSRF/open-redirect exposure and public product claims. It is a P0 architectural decision before production code.

### OT-03 Transport profile

The browser cannot directly use every MCP transport equally. The supported remote transport, CORS behavior, browser credential model, session semantics and server deployment assumptions must come from ENG-01 conformance artifacts.

### OT-04 Authentication and authorization

M1 must explicitly choose:

- no OAuth and controlled unauthenticated test endpoint;
- browser OAuth profile;
- backend-for-frontend/token mediator;
- another constrained architecture.

No implicit fallback is allowed.

### OT-05 Capability identity and drift

Define stable capability identity from more than display name. Candidate binding inputs:

- endpoint/server identity;
- protocol version;
- capability name and schemas;
- privilege class;
- policy version;
- canonical digest.

A digest detects drift but does not replace authorization or user approval.

### OT-06 Product value and primary user

The repository describes a public MCP client but has not yet proven who needs it, why existing clients are insufficient, or which single outcome justifies public release. Product discovery is therefore a blocking research stream, not optional polish.

### OT-07 Deployment topology

Static SPA, edge-hosted app, backend-for-frontend and installable PWA have materially different threat and privacy models. ADR-002 must decide the M1 topology before final CSP and credential design.

### OT-08 Public open-source readiness

Before changing visibility to public:

- license and third-party notices;
- secret/history scan;
- contribution and governance model;
- security reporting;
- privacy and trademark/name review;
- release and support policy;
- documentation claim audit.

### OT-09 Legal and regional requirements

The project needs a scoped legal/compliance review when target users, operator location, collected data and commercial model are known. Do not claim GDPR, Swiss FADP, EAA or other compliance solely from technical controls.

### OT-10 Observability without surveillance

Define the minimum operational telemetry needed for reliability and abuse detection. Default no-telemetry is privacy-favorable but production operations still need health, deployment and incident evidence. Metrics must avoid payloads and identifiers unless strictly justified.

## 3. Complete open-topic inventory

### Product

- primary persona and anti-persona;
- top task and measurable success;
- controlled versus arbitrary endpoints;
- naming and positioning to avoid “full browser” confusion;
- initial support and pricing/API-free model;
- public beta entry/exit criteria.

### Protocol and contract

- MCP version;
- transport;
- schemas/generated types;
- runtime validator;
- conformance kit;
- compatibility/deprecation;
- cancellation/progress;
- payload limits;
- endpoint identity;
- capability canonicalization/digest;
- error taxonomy;
- OAuth/no-OAuth profile.

### Architecture

- framework/build choice;
- deployment topology;
- state model;
- adapter seam;
- service worker/PWA decision;
- browser support matrix;
- environment/configuration model;
- safe-rendering strategy.

### Security

- endpoint allow/deny policy;
- URL and redirect policy;
- XSS/HTML/Markdown/SVG handling;
- prompt/tool/resource injection handling;
- session/replay protection;
- auth token handling;
- rate/size/depth/time limits;
- dependency and action pinning;
- SBOM/provenance;
- security headers;
- vulnerability reporting and SLA;
- fuzz/adversarial corpus;
- abuse and incident response.

### Privacy

- data-flow inventory;
- lawful/purpose analysis when product context exists;
- retention/deletion;
- storage sinks;
- diagnostics/redaction;
- consent and disclosure UX;
- endpoint operator responsibilities;
- privacy notice;
- user export/clear behavior;
- telemetry decision.

### Accessibility and UX

- WCAG 2.2 AA target;
- keyboard/focus/dialog/status patterns;
- screen-reader matrix;
- contrast/zoom/reflow/reduced motion;
- error recovery;
- consent comprehension and dark-pattern review;
- localization and plain-language strategy.

### Quality and verification

- test pyramid;
- deterministic mocks;
- contract tests;
- E2E matrix;
- performance budgets;
- memory/leak tests;
- flaky test policy;
- requirements-to-evidence matrix;
- independent review criteria;
- release acceptance report.

### Operations and governance

- branch protection and CODEOWNERS;
- release cadence/versioning;
- artifact signing/attestation;
- staging/production separation;
- rollback/cache invalidation;
- monitoring/SLOs;
- incident and vulnerability processes;
- supported versions;
- roadmap/ADR/risk/claim registers;
- Drive/GitHub source-of-truth synchronization.

## 4. Immediate actions already completed

- Merged PR #3 established the M1 design baseline.
- `nigin-engine#3` now carries the contract/conformance dependency.
- `browser#4` covers executable production bootstrap.
- `browser#5` covers hostile MCP/browser vectors.
- `browser#6` covers operational release governance.
- `browser#7` covers measured architecture selection.
- `docs/MASTER_ROADMAP.md` consolidates program workstreams and gates.

## 5. Next action order

1. Approve or amend this register and master roadmap.
2. Create ENG-01 interim contract-ownership ADR and resolve OT-01.
3. Resolve endpoint model OT-02 and primary use case OT-06.
4. Complete ENG-01 contract/conformance issue #3.
5. Run architecture spike #7 and accept ADR-002.
6. Implement secure bootstrap #4.
7. Build mock slice #2 and adversarial corpus #5 in parallel behind the adapter boundary.
8. Integrate ENG-01 only after G2.
9. Complete production operations #6 and final evidence review.

## 6. Stop conditions

Stop and return to design when any of the following occurs:

- real integration requires protocol behavior absent from ENG-01 artifacts;
- arbitrary endpoint support conflicts with browser/CSP/auth constraints;
- sensitive data appears in a prohibited sink;
- consent can be bypassed or becomes ambiguous after capability drift;
- a P0 risk lacks an enforceable control;
- release evidence cannot be reproduced from a clean checkout;
- public claims exceed verified behavior.