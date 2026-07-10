# APP-01 Browser — Implementation Status

- Updated: 2026-07-11
- Repository: `marcohost33-maker/browser`
- Scope: public privacy-first MCP client webapp
- Status: foundation and static security enforcement implemented; runtime MCP client not yet implemented

## Implemented and merged

- M0 scope, charter and APP-01/ENG-01 separation.
- Architecture, privacy, threat-model and MCP-consumer-profile foundations.
- Master roadmap, open-topics register and source/standards policy.
- Contract-artifact signing/provenance design.
- Machine-readable CSP and security-header baseline.
- Executable CSP serializer and fail-closed validation.
- Exact-origin `connect-src` allowlist enforcement.
- Protection against CSP override, source-token injection and header splitting.
- Security CI using Node's built-in test runner.
- Real HTTP-response integration test for served headers.
- 35 passing security tests reported by merged PR #15.

## Partially implemented

- Static CSP/header enforcement is active.
- Dynamic endpoint-to-CSP synchronization remains blocked on the endpoint/deployment ADR and runtime client.
- Security and documentation CI exist, but the full TypeScript application toolchain, browser E2E suite, SBOM and release provenance pipeline are not yet complete.

## Open P0 decisions

1. Primary user, top task and falsifiable product-value hypothesis — issue #14.
2. Endpoint trust model, browser transport, CORS and deployment topology — issue #13.
3. Pinned MCP contract, fixtures and conformance flow from ENG-01.
4. Architecture/build/framework decision after the endpoint model is fixed.

## Immediate engineering work

- Close issue #16: validate Referrer-Policy, Permissions-Policy and HSTS `includeSubDomains` values.
- Correct ADR numbering: ADR-002 is contract signing; later architecture decisions must use new identifiers.
- Update roadmap claims to reflect merged PR #15 and remaining runtime boundaries.
- Implement runtime only after product, endpoint and contract gates are satisfied.

## Production-readiness boundary

APP-01 is not production-ready. Missing evidence includes the product decision, endpoint/authorization architecture, MCP runtime, contract conformance, browser E2E, privacy sink tests, accessibility evaluation, SBOM/provenance, staging deployment, rollback and incident exercises.
