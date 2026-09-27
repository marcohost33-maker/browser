# Spike: TUF v1.0.36 Offline Metadata Verification

- Status: **executable research spike; not a production updater**
- Parent: ADR-009 / issue #24 Track C
- Runtime dependencies: none (Node.js standard library only)
- Network access: none
- Durable writes/activation: none

## Purpose

This spike turns the first ADR-009 invariants into executable evidence for a
self-contained offline update bundle. It verifies a proposed next trusted state in
memory and deliberately stops before persistence or package activation.

It is based on TUF Specification v1.0.36, including:

- four top-level roles: root, targets, snapshot and timestamp;
- unique signature key IDs and threshold counting;
- sequential root rotation signed by old and new root thresholds;
- rollback/freeze checks;
- snapshot and targets version/hash/length binding;
- target path, length and SHA-256 binding;
- recovery from trusted timestamp/snapshot fast-forward state after authorized key
  rotation;
- deletion of fast-forwarded targets versions learned only from the discarded
  snapshot while retaining the version of actually accepted targets metadata.

Primary specification: <https://theupdateframework.github.io/specification/v1.0.36/>

## Implemented POUF subset

The spike pins a deliberately narrow project profile:

- TUF `spec_version`: `1.0.36`;
- metadata and key IDs: deterministic JSON with safe integers and UTF-16 key order;
- canonical JSON depth/node limits and cycle rejection;
- expiry timestamps in exact `YYYY-MM-DDTHH:MM:SSZ` UTC form;
- signature scheme: raw-public-key Ed25519;
- digest: SHA-256;
- signatures over the project-canonical serialization of each metadata `signed`
  object;
- timestamp/snapshot length and hash descriptors over the exact metadata-file bytes
  received, never over a reconstructed serialization;
- strict raw UTF-8 JSON ingress with duplicate-key rejection before ordinary object
  semantics can overwrite an earlier value;
- parser-time byte, nesting-depth and JSON-node limits;
- metadata limit: 64 KiB per role by default;
- target limit: 64 MiB by default;
- bounded target paths, counts, keys, signatures and root-update chains;
- no networking, mirrors, compressed metadata or implicit capabilities;
- exact `app_id`, monotonic `app_version`, stable target path and package-bound
  capability list;
- an app version cannot be reused for different bytes or capabilities;
- capability expansion requires an explicit approval callback;
- verification returns a proposed next state and `persistenceRequired: true`.

## Current tests

The original TUF suite contains **20 deterministic tests** covering:

1. valid offline update;
2. normal same-timestamp no-update;
3. duplicate signature key rejection;
4. failed old/new root dual-threshold rotation;
5. valid role-key rotation and rollback-state reset;
6. snapshot-only key rotation resetting timestamp/snapshot fast-forward state;
7. preservation of actually accepted targets rollback state across key rotation;
8. snapshot mix-and-match bytes;
9. timestamp/snapshot version disagreement;
10. timestamp rollback;
11. expired timestamp/freeze signal;
12. noncanonical expiry rejection, including offset and fractional-second encodings;
13. target digest substitution;
14. targets metadata rollback;
15. validation of every signed target path;
16. capability escalation without re-consent;
17. exact approved capability expansion;
18. app-version reuse with changed capabilities;
19. metadata byte-envelope enforcement;
20. canonical JSON depth and cycle rejection.

The raw-ingress candidate adds dedicated tests for duplicate keys, escaped-equivalent
keys, malformed UTF-8, BOM policy, prototype-pollution resistance, unsafe numbers,
parser-time depth/node limits and non-byte inputs. It also adds end-to-end tests that
distinguish canonical signature bytes from exact metadata-file descriptor bytes:
noncanonical envelope whitespace/key order is accepted when the signed descriptor
binds those exact bytes, while a descriptor computed from a reconstructed
serialization is rejected.

Run:

```text
node --test "tests/tuf/*.test.js"
```

The fixtures use deterministic test-only Ed25519 seeds derived from public labels;
no reusable private key material is stored.

## Explicitly not implemented

- complete schema validation and a final application-ID grammar;
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
- raw-byte parsing and strict duplicate-key handling are independently reviewed and
  integrated through the untrusted ingress;
- delegated publisher fixtures and revocation are covered;
- state persistence is atomic and power-loss tested with package activation;
- an independent TUF implementation or oracle agrees on the accepted corpus;
- fuzzing, performance, memory and endless-data evidence pass;
- key-loss and out-of-band recovery drills are documented;
- independent security review approves the exact candidate.

## 2026-09-27 raw-ingress correction

The raw-ingress work intentionally does **not** require the complete metadata
envelope to be canonical JSON. That earlier candidate rule was rejected during
review because it would conflate two different TUF byte domains:

1. signature verification serializes the `signed` object according to the selected
   POUF; and
2. timestamp/snapshot metadata descriptors bind the exact bytes of the referenced
   metadata file.

The candidate therefore retains the exact downloaded bytes beside the parsed
objects and threads those bytes into descriptor length/hash verification.

The 2026-09-27 specification-delta review found that TUF v1.0.36 consolidates the
duplicate THRESHOLD definition and fixes specification markup without changing the
client threshold semantics used by this spike. The project POUF is therefore pinned
to v1.0.36 in a separate reviewable change.
