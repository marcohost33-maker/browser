# Spike: TUF v1.0.35 Offline Metadata Verification

- Status: **executable research spike; not a production updater**
- Parent: ADR-009 / issue #24 Track C
- Runtime dependencies: none (Node.js standard library only)
- Network access: none
- Durable writes/activation: none

## Purpose

This spike turns the first ADR-009 invariants into executable evidence for a
self-contained offline update bundle. It verifies a proposed next trusted state in
memory and deliberately stops before persistence or package activation.

It is based on TUF Specification v1.0.35, including:

- four top-level roles: root, targets, snapshot and timestamp;
- unique signature key IDs and threshold counting;
- sequential root rotation signed by old and new root thresholds;
- rollback/freeze checks;
- snapshot and targets version/hash/length binding;
- target path, length and SHA-256 binding;
- recovery from timestamp/snapshot fast-forward state after authorized key rotation.

Primary specification: <https://theupdateframework.github.io/specification/v1.0.35/>

## Implemented POUF subset

The spike pins a deliberately narrow project profile:

- TUF `spec_version`: `1.0.35`;
- metadata and key IDs: deterministic JSON with safe integers and UTF-16 key order;
- signature scheme: raw-public-key Ed25519;
- digest: SHA-256;
- canonical full-metadata bytes for length/hash descriptors;
- metadata limit: 64 KiB per role by default;
- target limit: 64 MiB by default;
- no networking, mirrors, compressed metadata or implicit capabilities;
- exact `app_id`, monotonic `app_version` and package-bound capability list;
- capability expansion requires an explicit approval callback;
- verification returns a proposed next state and `persistenceRequired: true`.

## Current tests

The test suite covers:

1. valid offline update;
2. normal same-timestamp no-update;
3. duplicate signature key rejection;
4. failed old/new root dual-threshold rotation;
5. valid role-key rotation and rollback-state reset;
6. snapshot mix-and-match bytes;
7. timestamp/snapshot version disagreement;
8. timestamp rollback;
9. expired timestamp/freeze signal;
10. target digest substitution;
11. targets metadata rollback;
12. capability escalation without re-consent;
13. exact approved capability expansion;
14. metadata byte-envelope enforcement.

Run:

```text
node --test tests/tuf/tuf-offline.test.js
```

The fixtures use deterministic test-only Ed25519 seeds derived from public labels;
no reusable private key material is stored.

## Explicitly not implemented

- raw JSON parsing or duplicate-key detection;
- delegated targets roles and path traversal through delegation graphs;
- repository/mirror networking and consistent-snapshot filenames;
- target streaming from an untrusted source;
- durable monotonic-state storage, locking or crash consistency;
- atomic coupling of metadata persistence and package activation;
- package/container verification from ADR-007a;
- root threshold-loss out-of-band recovery;
- real publisher admission, namespace authority or consent UI;
- independent implementation differential testing;
- production key custody, HSM integration, revocation operations or audit logging.

These omissions are acceptance blockers, not future claims.

## Promotion gate

The spike may advance only after:

- a reviewed POUF and schemas are fixed;
- raw-byte parsing and strict duplicate-key handling exist;
- delegated publisher fixtures and revocation are covered;
- state persistence is atomic and power-loss tested with package activation;
- an independent TUF implementation or oracle agrees on the accepted corpus;
- fuzzing, performance, memory and endless-data evidence pass;
- key-loss and out-of-band recovery drills are documented;
- independent security review approves the exact candidate.
