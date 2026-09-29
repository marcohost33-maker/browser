# Stateful TUF client research slice

This directory turns the generic top-level verifier into a stateful client surface
that matches the upstream client-under-test command model closely enough for staged
conformance work.

## Commands

`tuf-client-cli.mjs` exposes:

- `init`: persist the externally supplied trusted `root.json` exactly as received,
  into a directory without trusted metadata; a directory that already holds any of
  `root/timestamp/snapshot/targets.json` is refused (`METADATA_DIR_INITIALIZED`)
  instead of splicing a new root under old state;
- `refresh`: fetch and verify root/timestamp/snapshot/targets, then persist the exact
  verified metadata bytes; an unchanged timestamp version is `no-update`, but the
  retained timestamp/snapshot/targets are then re-verified as final metadata
  against the current root (signatures, hashes, versions, expiry), so a timestamp
  served again past its expiry or expired retained targets fail closed;
- `download`: refresh first, resolve a top-level target, verify length/SHA-256,
  then atomically replace the cached target.

The CLI is generic TUF infrastructure. Browser `app_id`, app-version and capability
policy remain outside this layer.

## Persistence model

Each individual file uses:

1. a same-directory exclusive temporary file;
2. complete write;
3. file `fsync`;
4. atomic rename;
5. parent-directory `fsync` where the platform exposes it.

This is **single-file crash safety only**. It does not yet claim a transaction across
root/timestamp/snapshot/targets, and it does not atomically couple metadata state to
package activation. Those remain ADR-009 blockers.

On Windows, directory fsync support must be measured separately. The function reports
whether the parent directory was synced rather than silently claiming durability.

## Network/resource policy

- only HTTP(S) metadata/target bases are accepted;
- redirects fail closed;
- metadata and target responses are streamed through configured byte ceilings;
- declared `Content-Length` is checked before body consumption;
- requests have a timeout;
- root updates are sequential and bounded;
- target paths use the existing project path validator;
- consistent-snapshot metadata and target filenames are derived from verified
  descriptors / project SHA-256 profile.

## Current scope limits

- top-level targets only; delegated targets are not implemented;
- Ed25519 + SHA-256 project POUF only;
- no mirror fallback;
- no multi-process metadata-directory lock yet;
- no cross-role atomic transaction;
- no package activation/last-good recovery coupling;
- Windows directory-fsync durability still needs platform evidence;
- official upstream `tuf-conformance` integration remains gated on the explicit
  algorithm/profile decision in issue #47.

These are explicit acceptance blockers, not implied product claims.
