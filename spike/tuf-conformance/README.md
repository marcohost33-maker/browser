# TUF Conformance Adapter

Status: research/conformance tooling, not the APP-01 production updater.

## Purpose

This directory contains a generic TUF 1.0.x client core used to measure the browser
repository against the independent
[`theupdateframework/tuf-conformance`](https://github.com/theupdateframework/tuf-conformance)
suite.

It is intentionally separate from `spike/tuf-offline-metadata/`:

- the APP-01 product POUF remains narrow and pinned to its reviewed serialization,
  key, capability and offline-package rules;
- the conformance adapter accepts the broader TUF 1.0.x interoperability surface so
  upstream tests can detect deviations without silently weakening the product POUF.

## Implemented conformance surface

The adapter currently implements:

- the client-under-test `init`, `refresh` and `download` workflow;
- exact received-byte persistence for trusted metadata;
- sequential root rotation with old-root and new-root threshold verification;
- timestamp, snapshot and targets rollback/freeze checks in specification order;
- fast-forward recovery after top-level key rotation;
- consistent-snapshot metadata and target filenames;
- optional metadata length/hash binding;
- SHA-256 and SHA-512 target verification;
- Ed25519, ECDSA P-256/P-384 and RSA-PSS SHA-256/384/512 verification;
- OLPC canonical JSON compatible with `securesystemslib`, including unknown fields;
- prioritized delegated-target traversal using pre-order depth-first search;
- path and path-hash-prefix delegation selectors;
- terminating delegations, cycle suppression and a bounded role budget;
- delegated metadata verification against the current delegator, including cache hits;
- safe local filenames for unusual delegated-role names;
- target cache verification before network retrieval;
- bounded downloads and redirect rejection.

## Independent result

The pinned upstream suite is
`theupdateframework/tuf-conformance` v2.5.0 at commit
`1bc18916ee35f753b6eb8ee19dabb98449ca7326`.

Current result on Node 22.23.1:

- **116 passed**
- **3 expected failures**
- **0 unexpected failures**

The three expected failures are ML-DSA-44, ML-DSA-65 and ML-DSA-87. They are not
implemented in the repository's pinned Node 22 crypto runtime. They are recorded
explicitly in `scripts/tuf-conformance-client.mjs.xfails`; no delegation or ordinary
TUF workflow test is waived.

## Run in CI

The authoritative workflow is:

`.github/workflows/tuf-conformance.yml`

It first runs the repository's pinned toolchain/lockfile checks and full `npm test`,
then invokes the upstream conformance action.

## Security boundaries

Passing this conformance suite is evidence of TUF protocol interoperability, not a
production-readiness claim for the browser updater. Promotion still requires the
APP-01-specific gates in ADR-009, including durable monotonic state, atomic coupling
to package activation/recovery, package-format verification, fuzz/resource evidence,
key-custody/recovery procedures and independent security review.
