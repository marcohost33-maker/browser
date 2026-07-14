# `browser`

Repository foundation for a native, offline-capable browser/webapp **runtime
program** that executes foreign web applications locally, staged from
owner-controlled (T1) toward arbitrary foreign web content (T3; the north star),
replacing cloud hosting and running without an AI layer.

This repository is **`marcohost33-maker/browser`**. It is one layer of a
three-layer stack — `browser` (runtime) · `nigin-engine` (contract core) ·
`browser-nigin` (AI layer). It is not `browser-nigin` and not `nigin-engine`.

> **Product reframe (2026-07-14).** `browser` was previously framed as a public
> MCP-client web application. Per Marco's 2026-07-14 decision it is reframed into
> the runtime program described above. The binding reframe record is
> **ADR-005/006/007** (see PR #22). The security/governance/CI foundation in this
> repository is framing-neutral and retained.

## Current state

`browser` is **not a functioning runtime and is not production-ready** (no runtime
product code exists under either the prior or the reframed framing). The
repository contains architecture, static security-policy, governance and CI
evidence foundations. Product validation, the runtime/trust-class design
(ADR-005/006/007), a signed `nigin-engine` contract, application runtime, browser
verification and operations remain open gates.

PR #17 is intentionally Draft until branch protection and independent final-head
review are completed or explicitly dispositioned.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) and
[`docs/verification/PRODUCTION_READINESS_MATRIX.md`](docs/verification/PRODUCTION_READINESS_MATRIX.md)
for the precise evidence state.

## Scope

`browser` will consume a signed and versioned contract from `nigin-engine` (the
contract core). It does not define that contract and is not the AI layer
(`browser-nigin`).

The runtime is delivered in staged trust classes — T1 (owner-controlled packages)
→ T2 (curated third-party) → T3 (arbitrary foreign web content; north star) — per
ADR-005/006/007. The binding runtime-framework choice (a Chromium engine such as
CEF/Electron is favoured for inherited site-isolation and a maintained engine
security-patch path over Tauri) is deferred to the measured comparison in ADR-006.
No framework is accepted yet.

## Static security foundation

The repository currently enforces and tests:

- CSP emitted from one machine-readable baseline plus an independent exact M1
  contract and checked policy metadata;
- exact-origin `connect-src` policy;
- HTTPS remote origins with explicit loopback-only HTTP development support;
- rejection of unapproved, noncanonical, localhost-misused and non-public or
  reserved address-literal origins;
- exact two-year HSTS, exact `no-referrer`, canonical Permissions-Policy and
  strict MIME, opener, embedder, resource and framing values;
- blocked HSTS preload until deployment and rollback approval;
- regression tests for injection, drift, duplicate/casing and downgrade bypasses;
- source-level prevention of application imports of raw security primitives;
- final in-process response-header readback that also rejects CORS, browser
  reporting, cookie and implementation-disclosure headers;
- fixed npm registry and lifecycle-script policy, deterministic install,
  machine-readable vulnerability snapshot, SPDX SBOM and evidence manifest;
- least-privilege, SHA-pinned GitHub Actions on the `ubuntu-24.04` runner family
  with workflow security audit.

The current CSP still contains provisional same-origin form, `data:` image, font,
manifest and worker capabilities. ADR-004 must remove each one unless measured
product/runtime evidence justifies retaining it.

These controls do not prove deployed edge behavior, browser compatibility,
runtime input safety, DNS/redirect/SSRF resistance, privacy, reproducible release
artifacts or production readiness.

Security policy and private vulnerability reporting are documented in
[`SECURITY.md`](SECURITY.md).

## Local verification

Required toolchain: exactly Node.js `22.23.1` and npm `10.9.8`, using the public
npm registry configured in `.npmrc` with lifecycle scripts disabled.

```bash
npm run toolchain:check
npm run lockfile:check
npm ci --ignore-scripts --audit=false --fund=false
npm run audit:ci
npm run csp:check
npm test
npm run csp:json
```

`npm run audit:ci` writes `npm-audit.json`; CI archives it with the SBOM and
security-evidence manifest. This provides traceability, not a bit-for-bit
reproducible release build.

## Decision order

```text
branch protection (#18) + independent final-head review (#20)
  -> merge the static foundation if approved
  -> product evidence (#14)
  -> endpoint/CORS/deployment ADR-003 (#13)
  -> signed and pinned ENG-01 contract
  -> framework/build/browser ADR-004 (#7)
  -> secure TypeScript application bootstrap
  -> mock and real read-only vertical slice
  -> browser/privacy/accessibility/security verification
  -> staging, provenance, rollback and incident gate
```

Runtime code must not bypass this order by embedding an unvalidated endpoint,
contract, capability or authorization assumption.

## Repository map

- [`docs/CHARTER.md`](docs/CHARTER.md) — purpose, principles and non-goals
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — short execution roadmap
- [`docs/MASTER_ROADMAP.md`](docs/MASTER_ROADMAP.md) — evidence-gated program
- [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) — active decision register
- [`docs/adr/`](docs/adr/) — architecture decisions
- [`docs/security/`](docs/security/) — threat and browser-policy profile
- [`docs/research/PRODUCT_DISCOVERY_PROTOCOL.md`](docs/research/PRODUCT_DISCOVERY_PROTOCOL.md)
  — falsifiable product discovery
- [`docs/verification/PRODUCTION_READINESS_MATRIX.md`](docs/verification/PRODUCTION_READINESS_MATRIX.md)
  — requirement/evidence/blocker matrix
- [`contracts/`](contracts/) — consumer profile; future verified ENG-01 input
- [`src/security/`](src/security/) — current static policy enforcement
- [`tests/security/`](tests/security/) — positive, negative and HTTP tests
- [`scripts/`](scripts/) — toolchain, lockfile and audit evidence gates

## Governance

- Critical paths are listed in `.github/CODEOWNERS`; enforcement still requires
  issue #18.
- Independent review of the exact final PR #17 head is tracked in issue #20.
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
