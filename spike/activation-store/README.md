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
   observed, full re-verification of the new version (objects are streamed through
   the hash, never loaded whole), last-good selection, binding verification. Then the
   commit re-establishes the barrier of every directory it relies on — `objects/` and
   the fan-out directory of every object reachable from the new commit — so that a
   commit never depends on how its objects arrived (a staging whose directory syncs
   never ran, an object left by a skipped collection). Only then is
   `state/.tmp-commit-*` written, `fsync`ed and renamed to `state/CURRENT`, after
   which `state/CURRENT` is `fsync`ed under its new name and `state/` is `fsync`ed.
   That rename is the only commit point.
3. **Collect.** After the commit, only objects unreachable from
   `{active, last-good, commit bindings}` are deleted. If a root cannot be read,
   nothing is deleted.
4. **Recover.** Remove temporaries, re-establish every barrier of the visible state
   (parent of root, `STORE` and root, `state/CURRENT` and `state/`), verify active,
   last-good and bindings, collect garbage only when every root verifies. Recovery
   never switches versions on its own: an invalid active version is reported
   fail-closed with `rollbackAvailable`.

This follows the pattern used by OSTree (checksum-validated immutable objects plus one
atomic swap: "either the old system, or the new one") and PostgreSQL's
`durable_rename` in full: fsync the file before the rename, fsync it again under its
new name, then fsync the containing directory. The post-rename file sync is not
decoration: on POSIX the directory sync is the barrier, but where directory handles
cannot be flushed (Windows) the file sync is the only barrier the platform offers,
and the store reports which one held (`commitBarrier`: `directory-fsync`,
`file-fsync-only` or `unavailable`).

### Reads and concurrency

Two serving primitives exist. `readResource` returns the bytes of a small resource
after re-hashing them. `openResource` is for large resources: it opens the object
once, hashes the whole file through that handle, and only then hands out a chunked
stream from the **same** handle — what is served is exactly what was verified, and
no byte leaves the store before the check passed. The stream closes the handle when
drained, abandoned or failed; nothing holds the object whole.

Neither takes a lock. A concurrent commit plus collection can therefore remove the
version or object a reader resolved a moment earlier. The reader repeats the
resolution exactly once when the object or record vanished **and** the commit
generation moved meanwhile; a miss on an unchanged generation is real damage and is
reported as such. Readers never block writers and never delay collection. A stream
already open when its version is collected keeps serving: the open handle pins the
bytes (POSIX unlink semantics; on Windows the adapter opens with `FILE_SHARE_DELETE`
through libuv).

The serving path keeps a small cache of validated version records (content-addressed,
therefore immutable). Without it every read re-parsed and re-validated the record —
about 100 ms per read for a 10,000-resource version. Commits, verification, recovery
and collection never consult the cache; a missing object evicts the entry and the
record is re-read, so a collected version is reported as missing exactly as before.

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

Eight scenarios (create store, first install, update, update with collection,
rollback, activation of a version staged by another process, activation of a version
whose staging never synced its directories, metadata-only bind) are interrupted
before each of their mutating filesystem calls. Every interrupted machine is observed
through these models, then recovered by a new process:

| Model | Meaning |
|---|---|
| `process-crash` | every completed call visible, nothing new durable |
| `posix-strict` | each directory persists its entries independently and in order; only `fsync(dir)` makes them durable; unsynced file contents are observed empty |
| `ordered-prefix` | metadata operations persist as one global prefix (ordered journal); directory `fsync`, where available, is a barrier |
| `recovery-crash` | recovery itself is interrupted at each of its calls, then recovery runs again |
| `post-recovery-power-loss/*` | power loss after a completed recovery; the state recovery made visible must stay |

Three variants describe what the platform offers. `directory-sync` is POSIX: the
directory `fsync` after the publishing rename is the barrier. `no-directory-sync` is
the Windows/NTFS hypothesis: directories cannot be flushed, metadata persists as an
ordered journal and the post-rename file `fsync` is a journal barrier. `no-barrier`
is the pessimistic reading of the same platform: no barrier at all, so the matrix
checks consistency only and claims no durability there.

| Variant / model | Crash cases | Distinct states | Consistent |
|---|---:|---:|---:|
| directory-sync / process-crash | 312 | 312 | 312 |
| directory-sync / posix-strict | 12,168 | 1,703 | 12,168 |
| directory-sync / ordered-prefix | 1,770 | 189 | 1,770 |
| directory-sync / recovery-crash | 5,048 | 5,048 | 5,048 |
| directory-sync / post-recovery power loss, posix-strict | 12,556 | 1,511 | 12,556 |
| directory-sync / post-recovery power loss, ordered-prefix | 1,509 | 148 | 1,509 |
| no-directory-sync / process-crash | 312 | 312 | 312 |
| no-directory-sync / ordered-prefix | 836 | 170 | 836 |
| no-directory-sync / recovery-crash | 5,048 | 5,048 | 5,048 |
| no-directory-sync / post-recovery power loss, ordered-prefix | 1,509 | 148 | 1,509 |
| no-barrier / process-crash | 312 | 312 | 312 |
| no-barrier / ordered-prefix | 4,547 | 189 | 4,547 |
| no-barrier / recovery-crash | 5,048 | 5,048 | 5,048 |
| no-barrier / post-recovery power loss, ordered-prefix | 7,103 | 810 | 7,103 |
| **Total** | **58,078** | | **58,078 (100 %)** |

Durability: in every variant with a barrier, **0** states lost a commit that was
durable before the crash — including the state of every operation that returned,
which the matrix now requires to be durable independently of what the trace shows.
Additionally, **312/312** process crashes across all eight scenarios on the real
Linux filesystem (ext4, Node adapter) recovered consistently; that run is
host-dependent and therefore printed by `--real-fs`, not committed. The
`activation-store-ci` workflow repeats it on Windows and macOS.

### Negative controls

A matrix that cannot fail proves nothing. Each control silently drops fsync calls; the
matrix must report violations:

| Control (variant) | posix-strict | ordered-prefix | Detected |
|---|---:|---:|---|
| object-directory fsync dropped (directory-sync) | 120 / 3,446 | 0 / 1,056 | yes |
| file-content fsync dropped (directory-sync) | 1,439 / 2,926 | 359 / 441 | yes |
| commit-directory fsync dropped before collection (directory-sync) | 268 / 3,332 | 14 / 488 | yes |
| post-rename file fsync of `CURRENT` dropped (no-directory-sync) | — | 3 / 179 | yes |

The first row is the expected model difference: an ordered metadata journal masks a
missing object-directory sync, a per-directory model exposes it. The protocol keeps
the sync because only the stricter model matches POSIX. The last row shows that the
post-rename file sync is load-bearing exactly where directories cannot be flushed:
drop it and a returned commit is no longer durable under the journal hypothesis.

A commit that trusted the staging history instead of re-establishing its own
object-directory barriers was measured the same way: with that control removed, the
`activate-after-unsynced-staging` scenario fails in 135 of 972 posix-strict states
(`active-invalid`); with it, in none.

### Mutation testing

[`harness/mutation-check.mjs`](harness/mutation-check.mjs) reverts nineteen controls
one at a time; every mutation makes at least one focused test fail (19/19 killed):
last-good root removed from collection, object-directory fsync, file fsync,
compare-and-swap, idempotent no-op, forbidden-key check, directory-name collisions,
live-lock protection, "no collection with an invalid root", commit-directory fsync,
post-rename file fsync, commit-side object-directory barriers, recovery barriers,
the streamed verification hash, the streamed-read digest check, root-ownership
check, layout-damage refusal, the per-read content hash and the refusal to
initialise over foreign content. The tool restores the source byte for byte and
fails when a mutation no longer applies, so the list has to follow the code.

### Latency and memory (ADR-007a section 9)

[`bench.mjs`](bench.mjs) measures p50/p95 latency per operation and peak memory for
six package shapes along the resource envelope (200 KiB to 512 MiB, 1 to 10,000
objects). Every profile runs in its own child process with `--expose-gc` and a
forced collection at each phase boundary, so a phase's peak is its own; contents
are generated deterministically and streamed, so the package never resides in
memory. The numbers below are from one ext4 VM (Linux 6.18, virtio disk, 4 vCPU
Xeon 2.8 GHz, Node 22.22.2) and are committed as
[`results/bench-linux-ext4-vm-2026-09-29.json`](results/bench-linux-ext4-vm-2026-09-29.json);
the `activation-store-ci` workflow repeats the bounded set on hosted Linux, Windows
and macOS runners and keeps each report as an artifact. `n` is the number of
iterations, so p95 for `n ≤ 3` is indicative only. Times in ms.

| Profile (n) | Package | stage p50 / p95 | activate p50 / p95 | verify p50 / p95 (MiB/s) | read p50 / p95 | open → first byte p50 / p95 | stream p50 (MiB/s) | recover p50 | peak buffers read / stream | peak RSS |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| small (5) | 50 × 4 KiB = 200 KiB | 125 / 139 | 80 / 93 | 37 / 43 (5) | 0.9 / 1.8 | 0.9 / 1.4 | 0.3 (12) | 49 | 6 / 13 MiB | 76 MiB |
| medium (3) | 500 × 32 KiB = 16 MiB | 1,382 / 1,450 | 516 / 583 | 334 / 336 (47) | 1.0 / 2.2 | 1.0 / 1.5 | 0.3 (98) | 383 | 2 / 32 MiB | 107 MiB |
| large (2) | 2,000 × 64 KiB = 125 MiB | 6,530 / 6,792 | 1,752 / 1,802 | 1,440 / 1,493 (87) | 1.0 / 1.8 | 1.1 / 2.0 | 0.3 (184) | 1,523 | 5 / 30 MiB | 124 MiB |
| big-object (3) | 1 × 64 MiB | 777 / 852 | 234 / 252 | 244 / 271 (262) | 223 / 229 | 220 / 236 | 86 (740) | 252 | 64 / 30 MiB | 127 MiB |
| many-tiny (1) | 10,000 × 256 B = 2 MiB | 17,918 | 6,689 | 6,141 (0.4) | 1.0 / 1.4 | 1.1 / 5.5 | 0.4 | 6,897 | 2 / 14 MiB | 144 MiB |
| envelope (1) | 8 × 64 MiB = 512 MiB | 9,446 | 1,820 | 1,804 (284) | 276 / 498 | 244 | 94 (684) | 1,854 | 128 / 64 MiB | 199 MiB |

What the numbers say:

1. **Staging is fsync-bound.** 1.8 to 3.3 ms per object on this disk whatever the
   object size, because every object is created, written, `fsync`ed and renamed and
   every touched fan-out directory is `fsync`ed once: 10,000 objects cost 18 s, while
   large objects stage at 54 to 85 MiB/s. This is a measured input for decision D4: a
   container that maps to few store objects stages in seconds, one that maps every
   file to an object pays per file.
2. **Activation and recovery cost one verification pass.** Hashing runs at 260 to
   285 MiB/s for large objects (512 MiB activate in 1.8 s) and about 0.6 ms per
   object for small ones (`lstat`, open, read, close), so 10,000 tiny objects verify
   in 6 s. Recovery is a verification plus barriers and costs the same.
3. **Serving is constant-time per resource.** Reads and opens cost about 1 ms
   whatever the version size, because the validated record is cached for serving;
   before that cache a read of a 10,000-resource version cost 99 ms. Opening a
   64 MiB resource pays the full hash (220 to 244 ms) before the first byte, then
   streams at about 700 MiB/s.
4. **Only the whole-object read scales with size.** Stage, activate, verify and
   recover hold about 1 MiB of buffers even for 512 MiB and keep the process at the
   Node.js baseline of about 63 MiB resident. `readResource` holds the object (64 MiB
   per read, 128 MiB with two in flight before collection). `openResource` keeps the
   live working set at one 256 KiB chunk; the 30 to 64 MiB its phase shows is copied
   chunks awaiting garbage collection, not live data, and a native runtime would not
   have it.

The same bounded set on hosted runners (`activation-store-ci`, run 36564687244 on
`dd28226`, Node 22.23.1; reports kept as artifacts `activation-bench-<os>`), next to
the VM above:

| Host | stage per object: small / medium / many-tiny | stage 64 MiB (MiB/s) | verify 64 MiB (MiB/s) | many-tiny: stage / activate | read p50: small / many-tiny | open → first byte, 64 MiB | stream 64 MiB (MiB/s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| ext4 VM, Xeon 2.8 GHz (table above) | 2.5 / 2.8 / 1.8 ms | 82 | 262 | 17.9 s / 6.7 s | 0.9 / 1.0 ms | 220 ms | 740 |
| `ubuntu-24.04`, ext4, EPYC 9V74 | 0.97 / 0.90 / 0.65 ms | 162 | 905 | 6.5 s / 3.2 s | 0.45 / 0.47 ms | 69 ms | 1,615 |
| `windows-2025`, NTFS, EPYC 7763 | 9.4 / 11.7 / 9.2 ms | 107 | 849 | 92.0 s / 6.2 s | 0.89 / 0.86 ms | 72 ms | 1,223 |
| `macos-15`, APFS, Apple M1 (virtual) | 2.4 / 2.3 / 1.8 ms | 158 | 1,172 | 17.8 s / 3.6 s | 0.36 / 0.74 ms | 62 ms | 2,301 |

The shape of the results is the same on every host; only the per-object fsync cost
moves. On NTFS a durable object costs 9 to 12 ms (create, write, `FlushFileBuffers`,
`MoveFileExW`), ten times ext4 on the same runner class, so a 10,000-file package
stages in 92 s there while it verifies and activates in 6 s. APFS with `F_FULLFSYNC`
sits between the two. Whole-object reads hold 64 MiB on every host; streaming holds
17 to 29 MiB of collected-later copies. For decision D4 this is the strongest
measured argument so far for a container that maps to few store objects, and for an
installer on Windows that shows progress rather than blocking.

The first run of this benchmark, before the two serving-path fixes, is kept as
negative results 8 and 9 below.

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
5. **A commit that trusted its history.** The first commit protocol relied on staging
   having synced the object directories. Any path that leaves objects visible but
   unsynced (a staging whose syncs never ran, an object kept by a collection that
   was skipped because a root was invalid) then produced a durable `CURRENT` pointing
   at objects a power loss could take away. The commit now re-establishes those
   barriers itself; the scenario that demonstrates it is part of the matrix.
6. **Barrier order.** Moving the parent-directory sync after the root sync during
   initialisation looked harmless and cost nothing in the tests; the matrix flagged
   5 `committed-state-lost` states within one run, because the durable point of a
   store creation is the root sync and the root's own entry must be durable before
   it. The order is parent first, then the published name and its directory.
7. **A claim the trace could not carry.** The durable point used to be derived from
   the trace alone, so a protocol that never called the barrier would never be held
   to durability. The matrix now additionally requires the state of every operation
   that returned to be durable; the missing post-rename file sync is caught that way.
8. **A read that loaded the object whole.** The section 9 benchmark showed peak
   buffer memory of 129 MiB for a 64 MiB resource: `readResource` allocated the
   object plus the read buffer. A runtime serving assets cannot do that. The
   `openResource` primitive verifies through one open handle and then streams from
   that handle, so peak buffers no longer follow the object size.
9. **A read that re-validated the version record.** Every read re-parsed and
   re-validated the record — 99 ms per read for a 10,000-resource version against
   2 ms for a small one. Validated records are content-addressed and immutable, so
   the serving path now caches them; the commit, verification, recovery and
   collection paths deliberately do not.

## Model limits and open assumptions

- The model generates empty contents for unsynced files. Partially written contents
  are equally caught by hashing but are not enumerated as separate states.
- The `no-directory-sync` variant stands for Windows/NTFS: metadata persists as an
  ordered prefix (a journal) and every file `fsync` is a journal barrier (write-ahead
  logging forces the sequential log up to the file's last change before its metadata
  reaches disk). Both halves are an **unverified hypothesis** until a Windows
  power-loss run exists. The `no-barrier` variant drops the second half and claims
  nothing beyond consistency, so the matrix is honest about what it cannot know.
- No real power loss was executed. A block-level replay (for example `dm-log-writes`)
  on Linux and a hard VM reset on Windows are open gates; hosted CI runners cannot
  do either.
- Hardware that acknowledges fsync without persisting is out of model.
- Only local filesystems are supported: exclusive create, `link()` and pid liveness
  are not trustworthy on NFS/SMB. FAT/exFAT volumes lack hard links.

## Platform notes

Checked against the libuv v1.x source (`src/win/fs.c`, `src/unix/fs.c`) and the
PostgreSQL `durable_rename()` source on 2026-09-29:

- Windows `rename()` is `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` **without**
  `MOVEFILE_WRITE_THROUGH` and without POSIX semantics: the rename itself is not
  write-through, and replacing `state/CURRENT` while another process holds it open
  fails. The commit then fails closed and can be retried; the old state stays active.
  A native implementation should use `MOVEFILE_WRITE_THROUGH` (or
  `FILE_RENAME_INFORMATION` with POSIX semantics), which Node.js does not expose.
- Windows directory handles cannot be flushed (`FlushFileBuffers` needs write
  access, which a directory handle is refused), so `syncDir()` reports false. The
  post-rename `syncFile()` of `state/CURRENT` (opened read-write there, since
  `FlushFileBuffers` needs it) is then the only barrier; the store reports
  `commitBarrier: "file-fsync-only"`. Whether that flush persists the preceding
  rename is the NTFS write-ahead-log hypothesis modelled by the `no-directory-sync`
  variant below — a hypothesis, not evidence.
- Windows `unlink()` removes the read-only attribute that a `0444` mode sets
  (libuv uses `FILE_DISPOSITION_IGNORE_READONLY_ATTRIBUTE`, with a fallback that
  clears the attribute), so immutable objects stay collectable. Windows has no
  `O_NOFOLLOW`; link refusal there rests on `lstat` before every read and on the
  account boundary.
- macOS `FileHandle.sync()` uses `F_FULLFSYNC`, falling back to `F_BARRIERFSYNC`,
  then `fsync`.
- POSIX exclusive create uses `O_CREAT|O_EXCL|O_NOFOLLOW`; with `O_CREAT|O_EXCL` an
  existing symbolic link is never followed. A store root owned by another account is
  refused (`STORE_ROOT_INVALID`), as is a world-writable or linked root.
- [`harness/platform-probe.mjs`](harness/platform-probe.mjs) records what a platform's
  adapter actually offers; the `activation-store-ci` workflow runs it together with
  the tests and the real-filesystem crash matrix on Windows and macOS. Measured on
  2026-09-29 (`windows-2025`, Windows Server 2025 10.0.26100, Node 22.23.1):
  `syncDir: false`, `syncFile: true`, `hasONoFollow: false`, hard links created and
  refused when present, exclusive create refuses an existing name, rename and
  unlink of a `0444` object succeed; the store reports `file-fsync-only` there and
  312/312 real-filesystem process crashes recovered on NTFS. `macos-15` (APFS):
  every probe true, 312/312.

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
account boundary is the trust boundary, which is why a root owned by another account
is refused rather than trusted on its mode bits. A torn or tampered `state/CURRENT`
is reported (`COMMIT_INVALID`) and never repaired automatically: the previous commit
record is gone after the rename by design, and inventing one would turn corruption
detection into a version switch. Recovering such a store is an operator action (an
explicit re-activation of a verified version) and an open owner decision. Signature verification, package format,
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
| `readResource(path, { versionId })` | no | resolves a key and re-hashes the object; one retry against a moved commit |
| `openResource(path, { versionId })` | no | verifies the object through one handle, then streams it in chunks from that handle |
| `verifyVersion(versionId)`, `status()`, `readVersion()` | no | read-only checks; verification streams every object |
| `recover({ breakStaleLock })`, `collectGarbage()` | yes | startup recovery and collection |

Every refusal is an `ActivationError` with a deterministic `code`, for example
`PATH_COLLISION`, `OBJECT_DIGEST_MISMATCH`, `GENERATION_CONFLICT`, `VERSION_INVALID`,
`NO_LAST_GOOD`, `LAST_GOOD_INVALID`, `COMMIT_INVALID`, `NAMESPACE_MISMATCH`,
`STORE_LOCKED`, `STORE_LAYOUT_INVALID` or `RESOURCE_INTEGRITY`.

## Run

```text
node --test "tests/activation/*.test.js"
node spike/activation-store/crash-matrix.mjs                # summary, exit 1 on any violation
node spike/activation-store/crash-matrix.mjs --write        # refresh the committed report
node spike/activation-store/crash-matrix.mjs --real-fs      # add real-filesystem process crashes
node spike/activation-store/crash-matrix.mjs --real-fs-only # what the Windows/macOS CI job runs
node spike/activation-store/harness/mutation-check.mjs      # every control must be tested
node spike/activation-store/harness/platform-probe.mjs      # what this platform's adapter offers
node spike/activation-store/bench.mjs [--ci|--full] [--dir <real disk>] [--json out.json]
ACTIVATION_MATRIX_FULL=1 node --test tests/activation/crash-matrix.test.js
```

`npm test` runs every crash point of every scenario under all models and variants,
the nested recovery checks for the small scenarios, the negative controls and a
real-filesystem subset. It also fails when the store or harness sources change
without a refreshed report. The opt-in full run rebuilds the report and requires
byte equality. The `activation-store-ci` workflow repeats the tests, the platform
probe, the full real-filesystem process-crash matrix and the bounded benchmark set
on Linux, Windows and macOS whenever the spike or its tests change, and keeps each
benchmark report as a workflow artifact (`activation-bench-<os>`, 90 days).

## Acceptance blockers

- wiring a verified container into `stageVersion` (needs the D4 container decision);
- power-loss evidence on Windows and macOS: process crashes now run in CI there, but
  the NTFS journal-barrier hypothesis behind `file-fsync-only` is untested against a
  real power loss;
- a real power-loss drill on Linux;
- serving `openResource` / `readResource` through the runtime's protocol handler
  (#23);
- coupling update metadata through commit bindings (ADR-009);
- section 9 numbers on target hardware: the benchmark exists and runs on hosted
  runners and one ext4 VM, which bound but do not represent end-user disks;
- independent security review of the exact candidate.
