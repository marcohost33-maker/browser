# Stateful TUF client research slice

This directory turns the generic top-level verifier into a stateful client surface
that matches the upstream client-under-test command model closely enough for staged
conformance work.

## Commands

`tuf-client-cli.mjs` exposes:

- `init`: persist the externally supplied trusted `root.json` exactly as received,
  into a directory without trusted metadata; a directory that already holds any of
  `root/timestamp/snapshot/targets.json` is refused (`METADATA_DIR_INITIALIZED`)
  instead of splicing a new root under old state. Before anything is written, the
  file must parse as strict JSON and verify as a root of this POUF signed by a
  threshold of its own root keys (TUF 5.2; expiry is not checked there); anything
  else fails closed with the verifier's error code;
- `refresh`: fetch and verify root/timestamp/snapshot/targets, then persist the exact
  verified metadata bytes; an unchanged timestamp version is `no-update`, but the
  retained timestamp/snapshot/targets are then re-verified as final metadata
  against the current root (signatures, hashes, versions, expiry), so a timestamp
  served again past its expiry or expired retained targets fail closed;
- `download`: refresh first, resolve a top-level target, verify length/SHA-256,
  then atomically replace the cached target.

The CLI is generic TUF infrastructure. Browser `app_id`, app-version and capability
policy remain outside this layer.

## Policy: an unchanged timestamp whose trusted copy has expired (#55)

When the repository serves the same timestamp version as the trusted one, the
client discards the new file and keeps the trusted timestamp, as TUF 1.0.36
section 5.4.3.2 requires ("discard the new timestamp metadata and abort the update
cycle. This is normal and it shouldn't raise any error"). It then still rejects
the cycle if that retained timestamp, or the retained snapshot/targets it pins,
has expired.

This is a **project policy, not a literal spec duty**: 5.4.3.2 itself says only
to abort without error. It is the same behaviour as the pinned independent oracle,
python-tuf 7.0.1:

- `Updater._load_timestamp()` catches `EqualVersionNumberError` and keeps the
  trusted timestamp;
- the following `TrustedMetadataSet.update_snapshot()` calls
  `_check_final_timestamp()`, which raises `ExpiredMetadataError` for an expired
  trusted timestamp.

Without it, a mirror that keeps serving one timestamp version past its expiry
would freeze the client on stale targets, the attack 5.4.4 exists to report.

Evidence: unit tests `refreshClient rejects an expired timestamp served again at
the trusted version` and `refreshClient does not keep using expired retained
targets on an unchanged timestamp` (`tests/tuf/tuf-client-cli.test.js`). The
python-tuf differential compares the core verifier only, so this client-level
path is **not yet** in the differential corpus.

## Persistence model

Each individual file uses:

1. a same-directory exclusive temporary file;
2. complete write;
3. file `fsync`;
4. atomic rename;
5. parent-directory `fsync` where the platform exposes it; when the parent had to be
   created, every directory that received a new entry from the recursive `mkdir`
   (up to the nearest pre-existing ancestor) is fsynced as well, and each sync is
   reported in `directorySyncs`.

This is **single-file crash safety only**. It does not yet claim a transaction across
root/timestamp/snapshot/targets, and it does not atomically couple metadata state to
package activation. Those remain ADR-009 blockers.

Two consequences of that are handled explicitly, so that a crash between two role
files cannot wedge or weaken the client:

- **Rotation reset survives a crash (TUF 5.3.11).** A refresh persists `root.json`
  first (5.3.8). If it dies before the new timestamp is written, old-key
  `timestamp.json`/`snapshot.json` remain next to the new root. On every load, the
  retained timestamp and snapshot are therefore verified against the loaded root
  (role, spec version, signature threshold; not expiry). If either does not verify,
  both are treated as deleted, exactly as 5.3.11 requires ("If the timestamp and /
  or snapshot keys have been rotated, then delete the trusted timestamp and snapshot
  metadata files"); `loadTrustedState()` reports this as `rollbackStateReset`.
  Without it, a fast-forwarded old-key timestamp would keep its rollback floor and
  freeze the client (`TIMESTAMP_ROLLBACK`) until the new-key timestamp overtook it.
- **Retained `targets.json` counts only while the trusted snapshot pins it (#55,
  #57).** The targets rollback floor is the version the trusted snapshot recorded
  (5.5.5). A retained `targets.json` is used as floor and as authorization source
  only if its exact bytes (length, SHA-256) and version match that snapshot's
  `targets.json` descriptor; otherwise it is a cache miss (`targetsUnpinned: true`,
  `parsed.targets: null`). With the snapshot rotated out, nothing pins it, so a
  fast-forwarded old-key `targets.json` cannot resurrect its floor after a crash and
  block the recovery chain with `TARGETS_ROLLBACK`. Rollback protection is not
  weakened: the snapshot-recorded floor stays, and in normal persistence order a
  retained `targets.json` is never newer than the one its snapshot pins.
- **Interrupted update resumes from the trusted timestamp (5.4.3.1).** If the
  repository timestamp equals the trusted one but the retained snapshot/targets are
  not the files that timestamp pins (crash after `timestamp.json`, or after
  `snapshot.json`), the refresh downloads snapshot/targets named by the trusted
  timestamp and verifies the whole chain again (`resumedFromTrustedTimestamp: true`).
  Only pin mismatches (`METADATA_LENGTH`, `METADATA_HASH`, `SNAPSHOT_VERSION`,
  `TARGETS_VERSION`, `INCOMPLETE_LOCAL_STATE`) trigger this; expired or badly signed
  retained metadata still fails closed, because re-downloading pinned bytes cannot
  change them.

All three are covered by crash simulations that abort the real write sequence after
file N (`tests/tuf/tuf-client-cli.test.js`). A real process kill or power loss has not
been measured.

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
