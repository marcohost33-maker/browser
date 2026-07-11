# APP-01 Browser

Privacy-first public MCP client webapp foundation for the Vero/Nigin system.

This repository is **`marcohost33-maker/browser`**. It is not `browser-nigin`
and does not contain the Engine/Wasmtime/WIT/CAS platform track.

## Current state

APP-01 is **not yet a functioning MCP web client and is not production-ready**.
The repository currently contains architecture, security, governance and CI
foundations. Product validation, endpoint/deployment acceptance, a signed ENG-01
contract and the TypeScript runtime remain open gates.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the
precise current state.

## Scope

APP-01 will consume a signed and versioned MCP contract from ENG-01. It does not
define the protocol or contract.

The first runtime slice, after its gates pass, is one explicit read-only user
action against an approved endpoint with visible consent, cancellation, bounded
results and privacy-safe session clearing.

## Security foundation

The repository enforces:

- restrictive CSP generated from one machine-readable baseline;
- exact-origin `connect-src` policy;
- HTTPS remote origins with explicit loopback-only HTTP development support;
- complete fail-closed M1 security-header validation;
- regression tests for injection, duplicate/casing and downgrade bypasses;
- deterministic installation and an SPDX SBOM CI artifact;
- least-privilege, SHA-pinned GitHub Actions with a workflow security audit.

Security policy and private vulnerability reporting are documented in
[`SECURITY.md`](SECURITY.md).

## Local verification

Requirements: Node.js 22 or newer and npm compatible with lockfile version 3.

```bash
npm ci --ignore-scripts --audit=false --fund=false
npm run csp:check
npm test
npm run csp:json
```

No lifecycle script is required for the current security foundation.

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
- [`contracts/`](contracts/) — consumer profile; future verified ENG-01 input
- [`src/security/`](src/security/) — current policy enforcement
- [`tests/security/`](tests/security/) — positive, negative and HTTP tests

## Governance

- Critical paths are covered by `.github/CODEOWNERS`.
- Dependency and GitHub Actions updates use Dependabot release cooldowns.
- Pull requests must link evidence and preserve fail-closed negative tests.
- The default branch still requires an enforced repository ruleset/branch
  protection before production or public-release claims.

## License and visibility

The repository is currently private and licensed under MIT. A public/open-source
release requires explicit approval and all security, privacy, accessibility,
legal, supply-chain and operational gates.
