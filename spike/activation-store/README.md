# Spike: Format-Neutral Activation Store (ADR-007a §6)

- Status: **executable research spike; not an installer and not wired to a verifier**
- Parent: [ADR-007a](../../docs/adr/ADR-007a-signed-package-verifier-hardening.md) section 6 / issue #24
- Runtime dependencies: none (Node.js standard library only)
- Network access: none
- Package format: **none selected** — the store accepts verified resources from any
  container and does not decide `.swbn`, NAR or ZIP (register D4 stays open)

## Purpose

ADR-007a section 6 requires content-addressed staging on the activation volume,
atomic activation only after verification, a bounded last-good version, deterministic
rollback and clean recovery "from power loss and interruption at every state
transition". None of this existed. This spike implements that layer below any package
format and measures the recovery claim with a crash matrix instead of asserting it.

The layer is deliberately policy-free: it never verifies signatures, admits
publishers, approves capabilities or decides update freshness. The caller supplies
resources whose digests and sizes come from a verified manifest; the store re-hashes
every byte it writes and refuses anything that does not match.

## Design

```text
<root>/
  STORE                   marker: schema + storeId, published last
  objects/<aa>/<62 hex>   immutable content-addressed objects (mode 0444)
  tmp/                    in-flight temporaries; garbage after any crash
  state/CURRENT           the single commit point (atomic same-directory rename)
  state/LOCK              exclusive writer lock (hard link, never replaced)
```

### Package paths never reach the filesystem

Payload bytes live under their SHA-256 address. Package paths exist only as keys of
a content-addressed version record. Path traversal, symlink and reparse-point
redirection, device names, case-folding collisions and similar extraction classes
from ADR-007a sections 4 and 6 are removed by construction rather than filtered.
Keys are still validated so that one version has one unambiguous key space: NFC,
no `.`/`..`/empty components, no control characters, no `\ ? # %`, no duplicate,
case-folded or compatibility-equivalent collisions, and no key that is also a
directory prefix of another key.

### Commit protocol

1. **Stage.** Each object is exclusively created in `tmp/`, written, `fsync`ed, checked
   against its declared digest and size, then renamed into `objects/<aa>/`. Every
   touched fan-out directory (and `objects/` for new fan-outs) is `fsync`ed before
   staging returns. The version record — canonical JSON, itself content-addressed —
   follows the same path.
2. **Activate.** Under the lock: compare-and-swap on the generation the caller
   observed, full re-verification of the new version, last-good selection, binding
   verification, then `state/.tmp-commit-*` is written and `fsync`ed and renamed to
   `state/CURRENT`, and `state/` is `fsync`ed. That rename is the only commit point.
3. **Collect.** After the commit, only objects unreachable from
   `{active, last-good, commit bindings}` are deleted. If a root cannot be read,
   nothing is deleted.
4. **Recover.** Remove temporaries, re-establish every barrier of the visible state
   (parent of root, root, `state/`), verify active, last-good and bindings, collect
   garbage only when every root verifies. Recovery never switches versions on its own:
   an invalid active version is reported fail-closed with `rollbackAvailable`.

This follows the pattern used by OSTree (checksum-validated immutable objects plus one
atomic swap: "either the old system, or the new one") and PostgreSQL's
`durable_rename` (fsync before and after the rename, then the parent directory).

### Retention is bound to the commit record

Retention is exactly `{active, previous, commit bindings}` as recorded in
`state/CURRENT`. It is never derived from file names or version numbers. This is the
fix for finding P1-RECOVERY-1 of the 2026-07-17 CWAP v0.1.1 cross-family review,
where retention by numeric order deleted the real last-good version.

Content addressing also removes finding P1-RECOVERY-2 by construction: an interrupted
staging is repeated byte for byte, existing objects are re-verified and reused, and
there is no pre-existing target that could wedge a retry.

### Last-good semantics

- `activate`: the displaced active version becomes last-good only if it still
  verifies; otherwise an older last-good that verifies is kept; otherwise none.
- `rollback`: last-good becomes active; the displaced version becomes last-good only
  if it verifies. Commit-level bindings are carried forward: update metadata must never
  roll back together with the package.
- Re-activating the active version is an idempotent no-op, so a retry after a crash
  never fails on a stale generation.

### Commit bindings

`commitBindings()` and `activate(…, { bindings })` commit named content-addressed blobs
in the same atomic rename that names the active version. This is the primitive ADR-009
lists as missing ("atomic metadata/package recovery"): trusted update metadata and the
activated package can move together or not at all. This spike does not modify the TUF
client work in pull requests #43, #46, #48 and #50, which is not yet wired to it.

### Locking

The lock file is created by hard-linking a fully written and synced temporary, so it
appears atomically with complete content and never replaces an existing lock. A lock is
broken automatically only when it is provably stale: same host, different pid and that
pid is not alive. An unreadable lock, another host or a live (possibly reused) pid
requires an explicit `force`. Release deletes only a lock whose bytes are still the
caller's own; otherwise `lockLost` is set.

## Evidence

All numbers below are reproduced by the committed, source-bound report
[`results/crash-matrix-report.json`](results/crash-matrix-report.json).

### Crash matrix

Six scenarios (create store, first install, update, update with collection,
rollback, metadata-only bind) are interrupted before each of their mutating
filesystem calls. Every interrupted machine is observed through these models, then
recovered by a new process:

| Model | Meaning |
|---|---|
| `process-crash` | every completed call visible, nothing new durable |
| `posix-strict` | each directory persists its entries independently and in order; only `fsync(dir)` makes them durable; unsynced file contents are observed empty |
| `ordered-prefix` | metadata operations persist as one global prefix (ordered journal); directory `fsync`, where available, is a barrier |
| `recovery-crash` | recovery itself is interrupted at each of its calls, then recovery runs again |
| `post-recovery-power-loss/*` | power loss after a completed recovery; the state recovery made visible must stay |

The `no-directory-sync` variant repeats the matrix on a machine whose directories
cannot be flushed (the situation of Node.js on Windows) and relies on the ordered
journal only.

| Variant / model | Crash cases | Distinct states | Consistent |
|---|---:|---:|---:|
| directory-sync / process-crash | 219 | 219 | 219 |
| directory-sync / posix-strict | 8,368 | 1,410 | 8,368 |
| directory-sync / ordered-prefix | 1,563 | 149 | 1,563 |
| directory-sync / recovery-crash | 3,034 | 3,034 | 3,034 |
| directory-sync / post-recovery power loss, posix-strict | 8,618 | 1,128 | 8,618 |
| directory-sync / post-recovery power loss, ordered-prefix | 956 | 128 | 956 |
| no-directory-sync / process-crash | 219 | 219 | 219 |
| no-directory-sync / ordered-prefix | 2,987 | 149 | 2,987 |
| no-directory-sync / recovery-crash | 3,034 | 3,034 | 3,034 |
| no-directory-sync / post-recovery power loss, ordered-prefix | 4,708 | 710 | 4,708 |
| **Total** | **33,706** | | **33,706 (100 %)** |

Durability: with a working directory barrier, **0** states lost a commit that was
durable before the crash. Additionally, **219/219** process crashes on the real Linux
filesystem (ext4, Node adapter) recovered consistently; that run is host-dependent and
therefore printed by `--real-fs`, not committed.

### Negative controls

A matrix that cannot fail proves nothing. Each control silently drops fsync calls; the
matrix must report violations:

| Control | posix-strict | ordered-prefix | Detected |
|---|---:|---:|---|
| object-directory fsync dropped | 106 / 2,602 | 0 / 766 | yes |
| file-content fsync dropped | 1,110 / 2,298 | 353 / 443 | yes |
| commit-directory fsync dropped before collection | 264 / 2,652 | 42 / 517 | yes |

The first row is the expected model difference: an ordered metadata journal masks a
missing object-directory sync, a per-directory model exposes it. The protocol keeps
the sync because only the stricter model matches POSIX.

### Mutation testing

[`harness/mutation-check.mjs`](harness/mutation-check.mjs) reverts fourteen controls
one at a time; every mutation makes at least one focused test fail (14/14 killed):
last-good root removed from collection, object-directory fsync, file fsync,
compare-and-swap, idempotent no-op, forbidden-key check, directory-name collisions,
live-lock protection, "no collection with an invalid root", commit-directory fsync,
recovery barriers, layout-damage refusal, the per-read content hash and the refusal
to initialise over foreign content. The tool restores the source byte for byte and fails when a mutation
no longer applies, so the list has to follow the code.

### Findings kept as negative results

1. **Initialisation durability.** A crash after creating the root but before syncing
   its parent left a root that a later successful initialisation never made durable;
   after a power loss the whole store vanished. Initialisation completion now syncs
   the parent. Found by the post-recovery power-loss model.
2. **Visible but not durable layout.** A crash after the marker rename but before the
   syncs left a marker that later opens accepted as initialised. Recovery now
   re-establishes every barrier of the visible state.
3. **Test that could not fail.** The first per-read integrity test corrupted objects by
   changing their length, so the size check masked a missing hash check. Corruption now
   flips a bit and keeps the length.
4. **Initialisation over foreign content.** Initialising inside a folder that already
   had a `tmp/` directory would have let recovery delete files the store never owned.
   Initialisation now refuses non-empty pre-existing store directories.

## Model limits and open assumptions

- The model generates empty contents for unsynced files. Partially written contents
  are equally caught by hashing but are not enumerated as separate states.
- `ordered-prefix` without directory sync stands for Windows/NTFS. That NTFS persists
  metadata as an ordered prefix is an **unverified assumption** until a Windows
  power-loss run exists.
- No real power loss was executed. A block-level replay (for example `dm-log-writes`)
  on Linux and a hard VM reset on Windows are open gates.
- Hardware that acknowledges fsync without persisting is out of model.
- Only local filesystems are supported: exclusive create, `link()` and pid liveness
  are not trustworthy on NFS/SMB. FAT/exFAT volumes lack hard links.

## Platform notes

Checked against the libuv v1.x source on 2026-09-27:

- Windows `rename()` is `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` without POSIX
  semantics: replacing `state/CURRENT` while another process holds it open fails. The
  commit then fails closed and can be retried; the old state stays active.
- Windows directory handles cannot be flushed; the store reports
  `commitBarrier: "unavailable"` instead of claiming durability.
- macOS `FileHandle.sync()` uses `F_FULLFSYNC`, falling back to `F_BARRIERFSYNC`.
- POSIX exclusive create uses `O_CREAT|O_EXCL|O_NOFOLLOW`; with `O_CREAT|O_EXCL` an
  existing symbolic link is never followed.

Internal records use canonical JSON with UTF-16 code-unit key order, matching the CWAP
rule in ADR-007a section 2. All record keys are ASCII, so the Unicode code-point order
adopted by the TUF spike in PR #48 would produce identical bytes.

## Threat boundary

In scope: interruption and power loss, corrupt or truncated objects, foreign or
unexpected store entries, pre-existing links at store paths, lock misuse, cross-store
records and pointer corruption (detected by a checksum, which is corruption detection,
not attacker resistance).

Out of scope: an attacker running as the same operating-system user, who can rewrite
any file, including a concurrent swap of the fixed store directories. For T1 the
account boundary is the trust boundary. Signature verification, package format,
publisher admission, capability approval and update freshness belong to the caller
and to ADR-007a/ADR-009; the store binds `packageDigest` and bindings for audit only.

## API

| Call | Lock | Effect |
|---|---|---|
| `openActivationStore({ root, storeId, create })` | — | opens or initialises; never heals damage |
| `stageVersion({ appVersion, packageDigest, resources, bindings })` | yes | writes verified objects and the version record; activates nothing |
| `activate(versionId, { expectedGeneration, bindings })` | yes | compare-and-swap commit of a fully re-verified version |
| `rollback({ expectedGeneration })` | yes | commit of the verified last-good version |
| `commitBindings(bindings, { expectedGeneration })` | yes | metadata-only commit |
| `readResource(path, { versionId })` | no | resolves a key and re-hashes the object |
| `verifyVersion(versionId)`, `status()`, `readVersion()` | no | read-only checks |
| `recover({ breakStaleLock })`, `collectGarbage()` | yes | startup recovery and collection |

Every refusal is an `ActivationError` with a deterministic `code`, for example
`PATH_COLLISION`, `OBJECT_DIGEST_MISMATCH`, `GENERATION_CONFLICT`, `VERSION_INVALID`,
`NO_LAST_GOOD`, `LAST_GOOD_INVALID`, `COMMIT_INVALID`, `NAMESPACE_MISMATCH`,
`STORE_LOCKED`, `STORE_LAYOUT_INVALID` or `RESOURCE_INTEGRITY`.

## Run

```text
node --test "tests/activation/*.test.js"
node spike/activation-store/crash-matrix.mjs            # summary, exit 1 on any violation
node spike/activation-store/crash-matrix.mjs --write    # refresh the committed report
node spike/activation-store/crash-matrix.mjs --real-fs  # add real-filesystem process crashes
node spike/activation-store/harness/mutation-check.mjs  # every control must be tested
ACTIVATION_MATRIX_FULL=1 node --test tests/activation/crash-matrix.test.js
```

`npm test` runs every crash point of every scenario under all models, the nested
recovery checks for the small scenarios, the negative controls and a real-filesystem
subset. It also fails when the store or harness sources change without a refreshed
report. The opt-in full run rebuilds the report and requires byte equality.

## Acceptance blockers

- wiring a verified container into `stageVersion` (needs the D4 container decision);
- Windows and macOS runs of the real-filesystem matrix and evidence for the NTFS
  ordering assumption;
- a real power-loss drill;
- serving `readResource` through the runtime's protocol handler (#23);
- coupling update metadata through commit bindings (ADR-009);
- p50/p95 activation latency and peak memory by package size (ADR-007a section 9);
- independent security review of the exact candidate.
