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
client discards the new file and keeps the trusted timestamp, as TUF section
5.4.3.1 requires ("In case they are equal, discard the new timestamp metadata and
abort the update cycle. This is normal and it shouldn't raise any error"; same
text in v1.0.35, v1.0.36 and v1.0.37). It then still rejects
the cycle if that retained timestamp, or the retained snapshot/targets it pins,
has expired.

This is a **project policy, not a literal spec duty**: 5.4.3.1 itself says only
to abort without error. (Earlier revisions of this README and commit `8e1ec01`
cited 5.4.3.2; that step is the snapshot-version check. Corrected on 2026-11-03
against the specification source.) It is the same behaviour as the pinned independent oracle,
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
- **A durable reset marker carries the reset past the timestamp write (#59
  review).** With only the timestamp keys rotated, the old snapshot still verifies
  under the unchanged snapshot keys, so the signature check above cannot see the
  reset once the new timestamp is on disk. A refresh under a reset therefore writes
  `rollback-reset.json` (`{"root_version": N}`) before `root.json` and removes it
  only after `targets.json`. While it names a root at or below the loaded one, every
  load clears the timestamp/snapshot floors. A marker naming a newer root comes from
  a crash before that `root.json`; it is ignored, and the next refresh detects the
  rotation again.
- **A pending reset keeps its root across a later root (C5).** If a refresh runs
  under a reset that is already pending and the repository has published a newer
  root meanwhile, the marker keeps the root since which the reset is pending
  instead of naming the new root. Naming the new root made a crash between the
  marker and the new `root.json` look like an uncommitted refresh: the marker was
  ignored, the fast-forwarded snapshot floor came back, and every later refresh
  failed with `SNAPSHOT_ROLLBACK` (measured before the fix).
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

All of these are covered by crash simulations that abort the real write sequence
before each rename and at the marker's removal (`tests/tuf/tuf-client-cli.test.js`,
cases C1 to C6; C4 and C6 run every crash point of a timestamp-only and a
snapshot-only key rotation). The rotations also run over several refreshes: every
pair of crash points across a repository that publishes a later root in between,
with a replay of the fast-forwarded chain between the crashes, and three crashes
in a row.

Real process kills are measured as well (BR64-04,
`tests/tuf/tuf-client-process-kill.test.js` with `process-kill-worker.mjs`): a
refresh process is killed with SIGKILL before every create, write, fsync, rename,
directory fsync, unlink and mkdir it performs, and after the last one, in three
scenarios (86 kill points). A fresh process then checks old-or-new-or-refused
(K1 to K5 in `THREAT-MODEL.md`, "Crash evidence"). Power loss is not measured: a
SIGKILL keeps the page cache, so a missing fsync stays invisible to this matrix.

A refresh starts by removing the temp files a killed refresh left
(`sweepStaleTempFiles()`, only for pids that are no longer running; the removed
names are `staleTempsRemoved` in the result).

After a refresh, and before `download` authorises a target, the state on disk is
read again and verified as one chain from those bytes (`readBack` in the result; a
mismatch is `PERSISTED_STATE_UNVERIFIED`, with the failing chain check as
`details.cause`). The same check is exported as `verifyTrustedStateOffline(dir,
{ now })` for a start with updates disabled: it reads and verifies, never writes or
repairs.

A read that sees a trusted file change under it (`LOCAL_STATE_CHANGED`, for
instance during a concurrent refresh in another process) is repeated in full, at
most three attempts in total (BR64-02; `readAttempts` in the loaded state). See
"Bounded fresh re-read" in `THREAT-MODEL.md`.

## Trusted-state boundary (P2-BR59-01)

The rollback floors are only as strong as the files that hold them. Whoever can
write the metadata directory can delete `timestamp/snapshot/targets.json` or write a
reset marker, and either one clears the floors. The cross-family review of #59
(2026-10-13) held the PR on exactly this point. The position is now explicit:

- **Other accounts are outside the boundary, and this is enforced** with the
  "secure directory" rule of [SEI CERT FIO15-C](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/input-output-fio/fio15-c)
  (the same idea as OpenSSH `StrictModes`). `loadTrustedState()` and `initClient()`
  raise `INSECURE_LOCAL_STATE`, before a byte is read and before any request, when:
  - the metadata directory or a trusted file (`root`, `timestamp`, `snapshot`,
    `targets`, `rollback-reset`) is a link or special file, belongs to another
    account than the effective uid, or is writable by group or others;
  - any directory above it, up to `/`, belongs to neither that account nor the
    superuser, or lets group/others write without the sticky bit (a sticky `/tmp`
    is fine: only an entry's owner may rename or delete it there). Without this
    check, an account that can write a parent could rename the metadata directory
    away and put its own in place between check and use.

  The location is resolved once with `realpath()`, and every later read and write
  goes through that checked path (`loadTrustedState().metadataDir`), so a link
  among the ancestors is not followed again after the check. Each file is opened
  once and checked on the descriptor (`fstat` against `lstat`: `dev`, `ino`, type,
  owner, mode), and only those bytes are verified. [THREAT-MODEL.md](THREAT-MODEL.md)
  separates cross-account from same-account actors and states what remains open:
  Node has no `openat()`, so resolving the directory path stays path-based. `init` checks
  the nearest existing ancestor of a directory it is about to create and creates
  nothing below an insecure one. The client creates its directories with mode
  `0700` and its files with `0600`, so a group-writable umask does not produce
  state the next load refuses.
- **The running account itself is inside the boundary, and this is stated, not
  hidden.** For that account a forged marker grants nothing beyond deleting the three
  role files. `tests/tuf/tuf-client-trust-boundary.test.js` proves the equivalence
  over all 18 differential-corpus cases (same result, same requests, same effective
  trust state, root floor untouched). It also pins the three validly signed older
  chains that both tamperings let through while the untouched floors refuse them.
- **TUF has the same limit.** The specification offers no protection against an
  attacker with local control of the trusted metadata store; specification issue
  [#107](https://github.com/theupdateframework/specification/issues/107) (open since
  2020) proposes a version backstop anchored outside mutable storage, such as
  verified-boot images. A comparable externally anchored monotonic backstop (signed
  image, TPM NV counter or an OS-protected store) is the precondition for any claim
  against same-account tampering. This spike does not make that claim.

On Windows there are no POSIX owner or mode bits: only the link/type rule for the
metadata directory and its files applies, the path is not canonicalised, and ACLs
are not inspected yet.

The target output directory of `download` is **not** trusted state and is not
checked: cached targets are re-verified against the trusted descriptor before
reuse, but whoever consumes a downloaded file must verify it again at the point
of use (the activation-store spike does).

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
- trusted state is protected against other accounts only; same-account tampering
  needs an externally anchored monotonic backstop, and Windows ACLs are not checked;
- official upstream `tuf-conformance` integration remains gated on the explicit
  algorithm/profile decision in issue #47.

These are explicit acceptance blockers, not implied product claims.
