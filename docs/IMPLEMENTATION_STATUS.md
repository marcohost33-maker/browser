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
- case-insensitive duplicate-header rejection;
- strict HSTS grammar, floor, duplicate and `includeSubDomains` enforcement;
- HSTS `preload` rejected pending deployment/rollback approval;
- canonical Referrer-Policy allowlist;
- reviewed exact Permissions-Policy deny set;
- strict COOP, COEP, CORP, MIME and framing values;
- canonical approved-origin validation;
- HTTPS remote origins and explicit loopback-only HTTP development origins;
- private/link-local IP-literal and trailing-dot host rejection;
- final in-process protected-header readback;
- negative tests for drift, casing, duplicates, malformed values, downgrades,
  private origins and final-response mutation.

These controls do not verify DNS resolution, redirects, DNS rebinding, deployed
edge transformations or supported-browser behavior.

### Deterministic evidence foundation

- exact Node `22.23.1` and npm `10.9.8` gates;
- exact documentation tools in lockfile v3;
- lockfile alignment, integrity, no-registry-URL and no-install-script checks;
- `npm ci --ignore-scripts` in all Node workflows;
- high-severity dependency vulnerability gate;
- SPDX 2.3 SBOM;
- evidence manifest binding source/tested SHA, tool versions and package/lock/SBOM
  hashes;
- SHA-pinned Actions, least privilege and workflow security audit.

### Governance and operations foundation

- active Charter and decision register;
- accepted ADR-001 boundaries and ADR-002 target trust design;
- proposed ADR-003 endpoint/CORS/deployment decision;
- falsifiable product-discovery protocol for issue #14;
- SECURITY.md vulnerability-reporting process;
- CODEOWNERS for critical paths;
- Dependabot with release cooldowns;
- pull-request evidence template;
- MIT license matching package metadata;
- evidence-gated roadmaps and production-readiness matrix;
- issue #18 for enforced branch protection;
- issue #20 for independent final-head review.

## Verified current candidate

Candidate head:

`db82c81cc016b559715f675dde3ea9dcf2596ab6`

On that exact head:

- security CI passed every toolchain, lockfile, install, audit, policy, test, SBOM
  and artifact step;
- Markdown lint and tracked-link checks passed;
- workflow security audit passed;
- evidence artifact
  `app-01-security-evidence-db82c81cc016b559715f675dde3ea9dcf2596ab6`
  was created with a GitHub artifact digest.

A later commit invalidates this exact-head evidence and must repeat all gates.
Documentation-only follow-up commits still require fresh docs/workflow checks and
must not silently inherit prior code evidence.

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
4. **ADR-004 (#7):** framework/build/browser decision after gates 1–3.

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
- staging, deployed-edge header verification, monitoring, rollback and incident
  exercises;
- Privacy Notice and Accessibility Statement derived from actual behavior.

## Production-readiness statement

APP-01 is **not production-ready** and is not a functioning MCP web client.
Draft PR #17 raises the quality and auditability of the static repository
foundation; it does not satisfy product, contract, runtime, deployed-browser,
accessibility or operational gates required for a production claim.

The next correct execution order is:

```text
#18 branch/ruleset enforcement + #20 independent final-head review
  -> merge static foundation if approved
  -> #14 product evidence
  -> #13 / ADR-003 endpoint spike and decision
  -> signed/pinned ENG-01 contract + conformance
  -> #7 / ADR-004 stack spike
  -> secure TypeScript bootstrap
  -> mock then real read-only vertical slice
  -> browser/privacy/accessibility/security verification
  -> staging, release provenance, rollback and incident gate
```
