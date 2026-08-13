# Contributing to `browser`

Thank you for looking at this repository. Please read this page before opening an
issue or a pull request — the project is early, and the rules below exist to keep
its evidence trustworthy rather than to add ceremony.

## What this repository is, and is not

`browser` is an architecture, security-policy and governance foundation for a
native, offline-capable runtime. It is **not yet a functioning runtime**: there is
no installer, package verifier, updater, runtime host or browser shell. See
[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the precise
evidence state and [`docs/ROADMAP.md`](docs/ROADMAP.md) for the active execution
order.

Contributions that implement runtime behaviour ahead of the decisions that gate it
will be declined regardless of code quality. Concretely: do not silently pick a
package format, publisher policy, capability authority, update model or endpoint.
Those are open decisions, tracked in
[`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) and in the ADRs under
[`docs/adr/`](docs/adr/).

## Reporting a vulnerability

**Do not open a public issue.** Use the private path in
[`SECURITY.md`](SECURITY.md).

## Before you open a pull request

Required toolchain: Node.js `22.23.1` and npm `10.9.8`, installed from the public
npm registry configured in `.npmrc` with lifecycle scripts disabled.

Run the offline local gate — it mirrors what CI enforces:

```bash
npm ci --ignore-scripts --audit=false --fund=false
npm run verify:local
```

Add `-- --with-network` to include the live npm audit:

```bash
npm run verify:local -- --with-network
```

The individual gates, if you need to run one in isolation:

| Command | Checks |
|---|---|
| `npm run toolchain:check` | Node/npm versions (advisory locally, exact in CI) |
| `npm run lockfile:check` | lockfile integrity and registry policy |
| `npm run docs:governance` | ADR identity, numbering and link consistency |
| `npm run csp:check` | emitted CSP against the exact policy contract |
| `npm test` | security, policy and regression tests |
| `npm run docs:lint` | markdown structure |
| `npm run audit:ci` | vulnerability evidence snapshot |

## Pull request expectations

`main` is protected by the `protect-main` ruleset: pull requests are required,
deletion and force-pushes are blocked, history is linear, and the
policy/security-test, markdown-lint, link-check and `zizmor` workflow-audit checks
must pass. Merges are squash or rebase.

A pull request is expected to:

- **link evidence for the exact head being merged.** A claim such as "tests pass"
  belongs in the description with the command and its output, not as an assertion;
- **preserve fail-closed negative tests.** If a negative test is removed or
  weakened, say so explicitly and justify it. A test that no longer fails when the
  behaviour it guards is reverted is not a test;
- **keep documents consistent with the change.** `npm run docs:governance` gates
  ADR identity and links; roadmap, status and open-decision documents should not
  be left claiming a state the change has just invalidated;
- **stay within one decision.** Mixing an architecture decision with unrelated
  refactoring makes both harder to review and to revert.

## Security-sensitive areas

Changes under `src/security/`, `tests/security/`, `docs/security/`, `scripts/`,
`docs/adr/`, `contracts/`, `.github/workflows/` and the dependency manifests are
security-critical (see [`.github/CODEOWNERS`](.github/CODEOWNERS)). For these,
state in the pull request which security boundary the change touches and what
would have to be true for the change to be unsafe.

Application code must not import raw security primitives directly; this is
enforced at source level and tested.

## Commits and issues

- Conventional-commit style prefixes (`fix:`, `docs:`, `security:`, `spike:`) are
  used throughout the history; please follow them.
- Issues carry priority labels `P0`/`P1`/`P2` and, where applicable,
  `critical-path`. If you are unsure whether work is wanted, open an issue that
  states the decision it would settle before writing code.

## Licence

By contributing you agree that your contributions are licensed under the MIT
licence in [`LICENSE`](LICENSE).
