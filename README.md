# `browser`

`browser` is the standalone repository for a native, offline-capable runtime that
installs and executes web applications locally. Delivery is staged by trust class:

- **T1:** owner-controlled, signed offline applications;
- **T2:** curated third-party, signed offline applications;
- **T3:** arbitrary foreign web content, the long-term north star.

The first shippable increment is T1. T3 is a separate security programme and must
not be represented as a hardened application window.

`nigin-engine` and `browser-nigin` are independent repositories. They may exchange
knowledge, but neither is a build-time, release-time or runtime dependency of
`browser`. MCP is an internal, optional capability and is off the T1 critical path.

## Current state

`browser` is **not yet a functioning browser runtime and is not production-ready**.
The repository currently contains:

- architecture and trust-class decisions;
- a fail-closed static CSP and security-header policy with regression tests;
- supply-chain, evidence and repository-governance foundations;
- a promoted canonical-manifest core for ADR-007 Track B
  (`CWAP-Strict-JSON v0.1.2`);
- an initial dependency-free TUF v1.0.35 offline metadata verification spike;
- runtime, package, update and product-discovery spike protocols.

No application installer, package verifier, updater, runtime host, browser shell or
production release path is implemented. A valid canonical manifest is not a valid
package, trusted publisher, approved capability set, safe update or safe program.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the precise
evidence state and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the active execution
order.

## Binding architecture

- [`ADR-005`](docs/adr/ADR-005-offline-runtime-trust-classes.md): staged T1 → T2 → T3 trust model.
- [`ADR-006`](docs/adr/ADR-006-runtime-evaluation-protocol.md): measured runtime evaluation; no framework accepted yet.
- [`ADR-007`](docs/adr/ADR-007-signed-package-evaluation.md): signed-package evaluation; Track B manifest core accepted, package format still open.
- [`ADR-007a`](docs/adr/ADR-007a-signed-package-verifier-hardening.md): consolidated verifier and activation requirements.
- [`ADR-008`](docs/adr/ADR-008-standalone-repository-and-mcp-capability.md): standalone repository; MCP internal and optional.
- [`ADR-009`](docs/adr/ADR-009-tuf-update-metadata-evaluation.md): proposed TUF-based update-metadata evaluation.

Earlier public-MCP-client framing in ADR-001/002/003 is historical or superseded.
Security controls that remain framing-neutral are retained.

## Security position

The current repository enforces and tests the static policy foundation:

- CSP emitted from a machine-readable baseline and checked against an independent
  exact contract;
- exact-origin network policy and loopback-only HTTP development exceptions;
- strict security-header values and final-response readback;
- rejection of duplicate, malformed, downgraded or prohibited headers and origins;
- deterministic npm installation policy, vulnerability evidence, SBOM generation
  and SHA-pinned least-privilege workflows;
- local CI-parity verification for required offline gates.

These controls do **not** prove runtime isolation, DNS/redirect resistance,
null-egress, safe package extraction, update security, browser compatibility,
privacy, accessibility or production operations.

For untrusted content, Chromium sandboxing, site isolation and Electron/CEF policy
are defense in depth. T3 requires an outer OS/container/VM boundary, process-tree
resource limits, an OS-enforced network deny and independent observation.

## Active critical path

```text
repository/document consistency guard
  -> #14 product discovery + #30 offline acquisition-mode decision
  -> #24 package verifier: finish container/signature/activation evidence
  -> ADR-009 / #24 Track C: TUF-style update metadata and recovery evidence
  -> #23 runtime spike: Electron baseline, CEF exit criteria, outer T3 isolation
  -> #25 publisher admission and capability governance
  -> smallest T1 install/verify/activate vertical slice
  -> hostile-input, null-egress, privacy, accessibility and release gates
```

Work may proceed in parallel where it does not encode an undecided product or
trust boundary. Runtime code must not silently choose a package format, publisher
policy, capability authority or update model.

## Local verification

Required CI toolchain: Node.js `22.23.1` and npm `10.9.8`.

```bash
npm run toolchain:check
npm run lockfile:check
npm ci --ignore-scripts --audit=false --fund=false
npm run docs:governance
npm run audit:ci
npm run csp:check
npm test
npm run docs:lint
```

For the normal offline local gate:

```bash
npm run verify:local
```

Use `npm run verify:local -- --with-network` to include the live npm audit. The
local toolchain-version check is advisory; CI owns exact-version enforcement.

## Repository map

- [`docs/CHARTER.md`](docs/CHARTER.md) — purpose, principles and non-goals
- [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) — current evidence state
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — active execution order
- [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) — unresolved owner decisions
- [`docs/adr/`](docs/adr/) — architecture decisions and sub-decisions
- [`docs/security/`](docs/security/) — threat and static browser-policy foundation
- [`docs/verification/`](docs/verification/) — evidence and readiness matrices
- [`spike/cwap-canonical-json/`](spike/cwap-canonical-json/) — accepted Track-B manifest core
- [`spike/tuf-offline-metadata/`](spike/tuf-offline-metadata/) — initial ADR-009 offline update verifier spike
- [`src/security/`](src/security/) and [`tests/security/`](tests/security/) — current executable policy foundation
- [`scripts/check-doc-governance.js`](scripts/check-doc-governance.js) — ADR identity/link consistency gate

## Release claim

The repository is **public** and MIT-licensed (see [`LICENSE`](LICENSE)).
Visibility was changed from private to public on 2026-08-13 by the repository
owner, which is the explicit approval the previous wording required.

Publishing is **not** a production or release claim. A production release
additionally requires runtime, package, update, privacy, accessibility, legal,
supply-chain and operational evidence that does not exist yet. No current
document and no green static test permits a production-security claim. What is
public is work in progress, including its open decisions and unfinished gates.

Two consequences of publication are irreversible and worth stating plainly:

- The **entire git history** is public, not only the current tree, together with
  all issues and pull requests.
- Documents here name and describe sibling repositories (`nigin-engine`,
  `browser-nigin`) that remain **private**. Their existence, roles and parts of
  their decision history are therefore public; their contents are not.

## Governance

- `main` is protected by the active `protect-main` ruleset: pull requests are
  required, deletion and force-pushes are blocked, history stays linear, and the
  policy/security-test, markdown-lint, link-check and `zizmor` workflow-audit
  checks must pass.
- Critical paths are listed in [`.github/CODEOWNERS`](.github/CODEOWNERS).
- Dependency and GitHub Actions updates use Dependabot release cooldowns.
- Pull requests must link exact-head evidence and preserve fail-closed negative
  tests.

## Contributing and security reports

Contribution rules, the local gate you are expected to run and the review
expectations are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

Please do **not** open a public issue for a suspected vulnerability — the
private reporting path is described in [`SECURITY.md`](SECURITY.md).
