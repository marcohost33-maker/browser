# APP-01 Browser — Implementation Status

- Updated: 2026-07-12
- Repository: `marcohost33-maker/browser`
- Intended product scope: public privacy-first MCP client web application
- Current change set: Draft PR #17
- Overall state: static security/governance/evidence foundation; MCP runtime absent

## Merged foundation

- APP-01/ENG-01 scope separation and non-goals.
- Threat Model, Privacy Model and MCP Consumer Profile.
- Initial architecture and supply-chain decision records.
- Machine-readable CSP/security-header baseline.
- CSP serializer, exact-origin allowlist and injection/override protections.
- Security, documentation and workflow-audit CI.
- In-process HTTP-response security-header tests.

## Implemented in Draft PR #17

### Static security enforcement

- exact M1 CSP directive contract independent from emitted baseline values;
- checked baseline version/date/top-level and `connect_src_policy` metadata;
- case-insensitive duplicate-header rejection;
- exact `max-age=63072000; includeSubDomains` HSTS value;
- HSTS `preload` rejected pending deployment/rollback approval;
- exact `Referrer-Policy: no-referrer`;
- exact ordered Permissions-Policy deny set;
- strict COOP, COEP, CORP, MIME and framing values;
- canonical approved-origin validation;
- HTTPS remote origins and explicit loopback-only HTTP development origins;
- non-public/reserved IPv4, IPv6, mapped-address and localhost rejection;
- source-level ban on application imports of raw serializer/map/apply validators;
- final in-process protected-header readback;
- rejection of final-response CORS, reporting, cookie and implementation-disclosure
  headers;
- negative tests for metadata drift, injection, casing, duplicates, malformed
  values, downgrades, non-public origins and final-response mutation.

These controls do not verify DNS resolution, redirects, DNS rebinding, deployed
edge transformations or supported-browser behavior.

### Provisional capability debt

The static baseline still provisionally permits same-origin forms, `data:`
images, fonts, a manifest and workers. ADR-004 must evaluate each capability and
remove it unless measured product/runtime evidence justifies retaining it.
Service-worker enablement additionally requires cache, update, persistence,
offline-threat and emergency-removal evidence.

### Evidence and supply-chain foundation

- exact Node `22.23.1` and npm `10.9.8` gates;
- public npm registry and `ignore-scripts=true` enforced through `.npmrc` and
  toolchain verification;
- exact documentation tools in lockfile v3;
- lockfile alignment, integrity, no-registry-URL and no-install-script checks;
- `npm ci --ignore-scripts` in all Node workflows;
- machine-readable high/critical vulnerability gate and archived
  `npm-audit.json`;
- SPDX 2.3 SBOM;
- evidence manifest schema 1.2 binding source/tested SHA, tool/registry/runner
  facts and package/lock/npmrc/audit/SBOM hashes;
- 90-day immutable security evidence artifact;
- `ubuntu-24.04` runner family, SHA-pinned Actions, least privilege and workflow
  security audit.

This is strong traceability, not bit-for-bit reproducibility. Hosted-runner image
patches, the live advisory database and timestamped evidence can differ between
reruns of the same source commit.

### Governance and operations foundation

- active Charter and decision register;
- accepted ADR-001 boundaries and ADR-002 target trust design;
- proposed ADR-003 endpoint/CORS/deployment decision;
- falsifiable product-discovery protocol for issue #14;
- SECURITY.md vulnerability-reporting process;
- expanded CODEOWNERS coverage for security, workflows, npm policy and evidence
  scripts;
- Dependabot with release cooldowns;
- pull-request evidence template;
- MIT license matching package metadata;
- evidence-gated roadmaps and production-readiness matrix;
- issue #18 for enforced branch protection;
- issue #20 for independent final-head review.

## Evidence protocol

The repository intentionally does not hard-code a "current final SHA" in this
file: changing the file would immediately create a different SHA. Exact candidate
identity and artifact digest are recorded outside the candidate tree in the PR,
GitHub Actions run, evidence artifact and independent review.

For every candidate head:

- security CI must pass toolchain, lockfile, install, audit, policy, tests, SBOM
  generation and evidence upload;
- Markdown lint and tracked-link checks must pass;
- workflow security audit must pass;
- the evidence artifact name, manifest and GitHub digest must bind to that head;
- any subsequent commit invalidates the prior candidate and requires fresh gates;
- independent review must name the exact final SHA it approved.

## Open P0 promotion gates for this foundation PR

1. **Repository enforcement (#18):** required checks, PR-only changes, resolved
   conversations, code-owner/latest-pusher-independent review, no force-push and
   minimized bypass.
2. **Independent final-head review (#20):** a reviewer other than the latest
   security-change author must review the exact final SHA and close P0/P1 findings.

The PR remains Draft until both are completed or explicitly dispositioned by the
Owner with evidence and bounded risk rationale.

## Product/runtime P0 gates

1. **Product evidence (#14):** primary user, anti-persona, one top read-only task
   and falsifiable go/pivot/stop result.
2. **ADR-003 (#13):** representative endpoint, CORS, auth, redirect, DNS/private
   network and deployment evidence.
3. **ENG-01 contract:** selected MCP revision, signed schemas/types, fixtures,
   limits and deterministic conformance flow.
4. **ADR-004 (#7):** framework/build/browser and capability-budget decision after
   gates 1–3.

## Runtime and release work not implemented

- TypeScript browser application and MCP adapter;
- endpoint manifest and runtime policy synchronization;
- DNS/redirect/private-network enforcement;
- real capability negotiation and bounded read-only request;
- OAuth/credential implementation and token-passthrough prohibition tests;
- hostile MCP corpus and browser exfiltration/injection E2E;
- sensitive-data sink tests;
- Permissions-Policy/COOP/COEP supported-browser compatibility matrix;
- scoped WCAG 2.2 evaluation;
- release artifact provenance and contract verifier;
- bit-for-bit reproducible application build and independent digest comparison;
- staging, raw-wire edge-header verification, monitoring, rollback and incident
  exercises;
- Privacy Notice and Accessibility Statement derived from actual behavior.

## Production-readiness statement

APP-01 is **not production-ready** and is not a functioning MCP web client.
Draft PR #17 raises the quality and auditability of the static repository
foundation; it does not satisfy governance enforcement, product, contract,
runtime, deployed-browser, accessibility, reproducible release or operational
gates required for a production claim.

The next correct execution order is:

```text
#18 branch/ruleset enforcement + #20 independent final-head review
  -> merge static foundation if approved
  -> #14 product evidence
  -> #13 / ADR-003 endpoint spike and decision
  -> signed/pinned ENG-01 contract + conformance
  -> #7 / ADR-004 stack and capability-budget spike
  -> secure TypeScript bootstrap
  -> mock then real read-only vertical slice
  -> browser/privacy/accessibility/security verification
  -> reproducible build, staging, provenance, rollback and incident gate
```
