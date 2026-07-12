# APP-01 Browser

Repository foundation for a proposed privacy-first public MCP client web
application in the Vero/Nigin system.

This repository is **`marcohost33-maker/browser`**. It is not `browser-nigin`
and does not contain the Engine/Wasmtime/WIT/CAS platform track.

## Current state

APP-01 is **not a functioning MCP web client and is not production-ready**. The
repository contains architecture, static security-policy, governance and CI
evidence foundations. Product validation, endpoint/deployment acceptance, a
signed ENG-01 contract, application runtime, browser verification and operations
remain open gates.

PR #17 is intentionally Draft until branch protection and independent final-head
review are completed or explicitly dispositioned.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) and
[`docs/verification/PRODUCTION_READINESS_MATRIX.md`](docs/verification/PRODUCTION_READINESS_MATRIX.md)
for the precise evidence state.

## Scope

APP-01 will consume a signed and versioned MCP contract from ENG-01. It does not
define the protocol or producer contract.

The first runtime slice, after its gates pass, is one explicit read-only user
action against an approved endpoint with visible consent, cancellation, bounded
results and privacy-safe session clearing.

## Static security foundation

The repository currently enforces and tests:

- CSP emitted from one machine-readable baseline plus an independent exact M1
  contract that prevents silent data-only widening;
- exact-origin `connect-src` policy;
- HTTPS remote origins with explicit loopback-only HTTP development support;
- rejection of unapproved, noncanonical and private/link-local IP-literal origins;
- a reviewed fail-closed M1 static security-header contract;
- blocked HSTS preload until deployment and rollback approval;
- regression tests for injection, drift, duplicate/casing and downgrade bypasses;
- final in-process response-header readback;
- deterministic installation, vulnerability audit, SPDX SBOM and evidence
  manifest;
- least-privilege, SHA-pinned GitHub Actions with workflow security audit.

These controls do not prove deployed edge behavior, browser compatibility,
runtime input safety, SSRF resistance, privacy or production readiness.

Security policy and private vulnerability reporting are documented in
[`SECURITY.md`](SECURITY.md).

## Local verification

Required toolchain: exactly Node.js `22.23.1` and npm `10.9.8`.

```bash
npm run toolchain:check
npm run lockfile:check
npm ci --ignore-scripts --audit=false --fund=false
npm run audit:ci
npm run csp:check
npm test
npm run csp:json
```

No lifecycle script is required or permitted by the current locked tool graph.

## Decision order

```text
product evidence (#14)
  -> endpoint/CORS/deployment ADR-003 (#13)
  -> signed and pinned ENG-01 contract
  -> framework/build/browser ADR-004 (#7)
  -> secure TypeScript application bootstrap
  -> mock and real read-only vertical slice
  -> browser/privacy/accessibility/security verification
  -> staging, provenance, rollback and incident gate
```

Runtime code must not bypass this order by embedding an unvalidated endpoint,
contract or authorization assumption.

## Repository map

- [`docs/CHARTER.md`](docs/CHARTER.md) — purpose, principles and non-goals
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — short execution roadmap
- [`docs/MASTER_ROADMAP.md`](docs/MASTER_ROADMAP.md) — evidence-gated program
- [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) — active decision register
- [`docs/adr/`](docs/adr/) — architecture decisions
- [`docs/security/`](docs/security/) — threat and header policy
- [`docs/research/PRODUCT_DISCOVERY_PROTOCOL.md`](docs/research/PRODUCT_DISCOVERY_PROTOCOL.md)
  — falsifiable product discovery
- [`docs/verification/PRODUCTION_READINESS_MATRIX.md`](docs/verification/PRODUCTION_READINESS_MATRIX.md)
  — requirement/evidence/blocker matrix
- [`contracts/`](contracts/) — consumer profile; future verified ENG-01 input
- [`src/security/`](src/security/) — current static policy enforcement
- [`tests/security/`](tests/security/) — positive, negative and HTTP tests

## Governance

- Critical paths are listed in `.github/CODEOWNERS`; enforcement still requires
  issue #18.
- Independent review of the final PR #17 head is tracked in issue #20.
- Dependency and GitHub Actions updates use Dependabot release cooldowns; the
  first scheduled post-merge cycle remains operational evidence.
- Pull requests must link exact-head evidence and preserve fail-closed negative
  tests.
- No production or public-release claim is permitted while the matrix production
  gate is open.

## License and visibility

The repository is private and licensed under MIT. A public/open-source release
requires explicit approval and all applicable security, privacy, accessibility,
legal, supply-chain and operational gates.
