# APP-01 Browser — Implementation Status

- Updated: 2026-07-11
- Repository: `marcohost33-maker/browser`
- Scope: public privacy-first MCP client webapp
- Current change set: PR #17
- Overall state: security/governance foundation under review; MCP runtime absent

## Merged foundation

- APP-01/ENG-01 scope separation and non-goals.
- Threat Model, Privacy Model and MCP Consumer Profile.
- Initial architecture and supply-chain decision records.
- Machine-readable CSP/security-header baseline.
- CSP serializer, exact-origin allowlist and injection/override protections.
- Security, documentation and workflow-audit CI.
- Real HTTP-response security-header tests.

## Implemented in PR #17

### Security enforcement

- complete required M1 security-header set;
- case-insensitive duplicate-header rejection;
- strict HSTS grammar, floor, duplicate and `includeSubDomains` enforcement;
- canonical Referrer-Policy allowlist;
- exact lowercase Permissions-Policy parsing and powerful-feature disablement;
- strict COOP, COEP, CORP, MIME and framing values;
- canonical approved-origin validation;
- HTTPS production origins and explicit loopback-only HTTP development origins;
- negative tests for casing, duplicates, malformed values, downgrades and unsafe
  origins;
- deterministic install, security tests and SPDX SBOM generation in CI.

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
- evidence-gated roadmaps and standards register.

## Verified on the PR branch

Before the latest governance/document updates, the hardened header/origin code
passed:

- security CI;
- Markdown lint and link checks;
- workflow security audit.

Every later commit must repeat all three checks. A previous green commit is not
evidence for an untested new head.

## Open P0 gates

1. **Product evidence (#14):** primary user, one top read-only task and a
   falsifiable go/pivot/stop result.
2. **ADR-003 (#13):** representative endpoint, CORS, auth, redirect and
   deployment evidence.
3. **ENG-01 contract:** selected MCP revision, signed schemas/types, fixtures,
   limits and deterministic conformance flow.
4. **ADR-004 (#7):** framework/build/browser decision after gates 1–3.

## Runtime and release work not implemented

- TypeScript browser application and MCP adapter;
- endpoint configuration manifest and runtime policy synchronization;
- real capability negotiation and bounded read-only request;
- OAuth/credential implementation;
- hostile MCP corpus and browser exfiltration/injection E2E;
- sensitive-data sink tests;
- scoped WCAG 2.2 evaluation;
- release artifact provenance and contract verifier;
- staging, monitoring, rollback and incident exercises;
- Privacy Notice and Accessibility Statement derived from actual behavior;
- enforced branch protection/ruleset on `main`.

## Production-readiness statement

APP-01 is **not production-ready** and is not yet a functioning MCP web client.
PR #17 raises the quality of the repository foundation; it does not satisfy the
product, runtime, deployment or operational gates required for a production
claim.

The next correct execution order is:

```text
#14 product evidence
  -> #13 / ADR-003 endpoint spike and decision
  -> signed/pinned ENG-01 contract + conformance
  -> #7 / ADR-004 stack spike
  -> secure TypeScript bootstrap
  -> mock then real read-only vertical slice
  -> browser/privacy/accessibility/security verification
  -> staging, release provenance, rollback and incident gate
```
