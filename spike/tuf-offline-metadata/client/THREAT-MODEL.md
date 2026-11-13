# Threat model of the local TUF trusted state

Scope: the files of one metadata directory and how `client-core.mjs` reads them. The
network side is TUF itself; this document is about who can touch the disk.

No exploit is claimed here. The path-based read this replaces left windows between
check and use, but no actor with the access to use them, and without that access
they were not an attack. This document says which actor is stopped by what, and
which one is not stopped at all.

## Actors

| Actor | Capability | Position | Enforced by |
| --- | --- | --- | --- |
| Remote repository or mirror | Serves any bytes | Stopped | TUF signatures, versions, expiry, byte ceilings |
| Other account, same machine (cross-account) | Own UID, no write access to the state | Stopped on POSIX | Secure-directory rule (FIO15-C) on the directory, its ancestors and every file, repeated on the open descriptor |
| Other account with write access to an ancestor | Could rename the directory away | Refused before a byte is read | Ancestor rule, `INSECURE_LOCAL_STATE` |
| Same account (same UID), any process | Can rewrite, delete or swap every file | **Not stopped** | Nothing can be, see below |
| Administrator / root, kernel, hypervisor | Everything | Not stopped | Outside this model |
| Other account on Windows | Depends on ACLs | **Not evaluated** | ACLs are not inspected; link and type rule only |

### Same account

A same-account writer can delete the role files, which clears the rollback floors.
That is equivalent to a forged reset marker, and
`tests/tuf/tuf-client-trust-boundary.test.js` proves the equivalence over the
differential corpus. It can also write back an older signed chain. TUF has no answer
either (specification issue #107). A real defence needs a monotonic backstop outside
mutable storage: a TPM NV counter, a signed image, an OS-protected store.

So the descriptor checks below are **not** a defence against this actor. Against it
they only narrow the windows in which a change goes unnoticed, and a change that
restores size, mtime and ctime can stay unnoticed. What they do provide:

- every later verification sees exactly the bytes that were read;
- a concurrent or crashing writer of the same account fails closed instead of
  producing a mixed read;
- a cross-account object that appears despite the directory rule, for instance after
  an administrator changed the rights, is checked on the descriptor.

## What a read does

`readTrustedFileOnce()`, the only reader of trusted state:

1. `lstat` the path: regular file, owner, mode.
2. Open once with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`.
3. `fstat` the descriptor: the same rules again, plus `dev` and `ino` equal to step 1
   (as bigint, because an NTFS file id does not fit a double).
4. Read through that descriptor, bounded by the limit plus one byte.
5. `fstat` again: size, mtime and ctime unchanged. On POSIX this also refuses an
   atomic replacement during the read, although the bytes read are intact: the rename
   takes a link from the open inode, which changes its ctime. A concurrent refresh can
   therefore make a read fail; `loadTrustedState()` then reads again (see below).
6. Return those bytes. There is no second open of the path.

`readTrustedRoleFiles()` also compares the directory's `dev`/`ino` before and after
all role files, so the files of two directory instances are never verified as one
state.

After a refresh, and before `download` authorises a target, `loadVerifiedChain()`
reads everything once more this way and runs the full chain through the core verifier
from those bytes, without any retained floor. After an update, the digests must equal
the files that were verified. This re-verification catches a disk that does not hold
what was verified. It does not prove the disk will still hold it a moment later.

### Bounded fresh re-read (BR64-02)

`loadTrustedState()` repeats the whole read after `LOCAL_STATE_CHANGED`, at most
three attempts in total, pausing 10 ms and then 50 ms. Every attempt starts from
the requested path: the directory boundary rules run again (a directory replaced
in between is a new object and must pass them), every role file and the marker are
opened through new descriptors, and nothing from a refused attempt is kept. Only
`LOCAL_STATE_CHANGED` is retried; `INSECURE_LOCAL_STATE` and every parse or
verification error fail at once. After the third refusal the error is thrown with
`details.attempts = 3`. The refusal rule itself is unchanged: no attempt is ever
accepted with an object that changed under it. An attempt may still see the state
between two writes of a concurrent refresh; that is the state a crash leaves and
is handled the same way (resumed by the next refresh, refused by the read-back).
`tests/tuf/tuf-client-read-retry.test.js` pins all of this, and four mutants of the
study fail it.

| Result | Meaning |
| --- | --- |
| `INSECURE_LOCAL_STATE` | The object breaks the account rule, or became a link between check and open |
| `LOCAL_STATE_CHANGED` | Another rule-conforming object or changed content. A concurrent atomic replacement looks the same, so this names no cause |
| `PERSISTED_STATE_UNVERIFIED` | The disk is not one complete chain, or not the verified bytes. Whichever chain check fails first, the code is this one; the verifier's own code is `details.cause`, an incomplete or reset state is named in `details` |

## Limits

- **Directory path resolution stays path-based.** Node has no `openat()`. Between the
  directory check and each open, an intermediate component can change. The `realpath`
  from the existing boundary and the identity comparison above make this fail closed
  in most interleavings. They do not close it: a swap and a swap back between two
  checks is not seen.
- **Windows:** `O_NOFOLLOW` and `O_NONBLOCK` do not exist there, so step 1 and step 3
  carry the rule alone, without the owner and mode bits. A file held open by a reader
  cannot be renamed over (EPERM, measured), which also makes a concurrent refresh fail
  rather than interleave. ACLs are not inspected.
- **mtime granularity:** a same-size rewrite within the file system's timestamp
  resolution, with an equal ctime, is not detected. This is a consistency check, not
  an integrity check.
- **Process kills are measured; power loss is modelled, not measured on hardware.**
  `tests/tuf/tuf-client-process-kill.test.js` kills real refresh processes with
  SIGKILL (single kills, a second kill inside the recovery, kills during the
  bootstrap). A SIGKILL leaves the page cache intact, so it proves the ORDER of the
  protocol against a process crash, OOM kill or forced termination, and cannot show a
  missing fsync. `tests/tuf/tuf-client-power-loss.test.js` covers that part with the
  abstract persistence model of ALICE (Pillai et al., OSDI 2014;
  `tests/tuf/power-loss-model.mjs`): the exact operations of a refresh are recorded,
  and every on-disk state a power cut after each operation may leave is built and
  checked. The model is stricter than ext4 `data=ordered` (data durable only after
  fsync of the file, directory operations durable only after fsync of the directory,
  any subset of pending ones may survive). Not covered: torn writes inside one
  write call, devices that acknowledge a flush they did not perform, metadata other
  than the directory entries, and real hardware. A LazyFS run (FUSE layer that drops
  unsynced data) was prepared but not executed: building external code is not
  permitted in the environment where this evidence was produced; it remains the next
  step for a measured rather than modelled result.

## Linux `openat2` (evaluation, not implemented)

`openat2(2)` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`, relative to a descriptor of
the checked directory, would remove the path-resolution window on Linux instead of
detecting it. No portable Node API exposes it: `fs` offers neither `openat` nor
`openat2`, and `/proc/self/fd/<n>/<file>` emulates only the directory anchoring, with
a dependency on a mounted `/proc`. Using it means a native addon or a helper process,
that is a new native dependency in a project whose statement is "runtime dependencies:
none", for a window that only an actor already refused by the ancestor rule, or the
same account, can reach. Not adopted for this spike. It belongs on the table when a
native runtime (#23) exists anyway, together with the monotonic backstop.

## Crash evidence (BR64-04)

Contract per kill point, checked by a fresh process that first observes the
directory exactly as the killed process left it:

| ID | Property |
| --- | --- |
| K1 | Every role file is byte-equal to its old or its new version (no torn, empty or foreign file) |
| K2 | `verifyTrustedStateOffline()` verifies exactly the old or the new complete chain and refuses everything in between with `PERSISTED_STATE_UNVERIFIED`; an untouched old state stays usable offline |
| K3 | Replaying the old bundle never verifies after a crash, and fails once anything new was committed (no floor goes back through a crash) |
| K4 | One refresh with the new bundle reaches exactly the new state, without reset marker and verified offline; a second refresh is a no-update |
| K5 | No temp file survives the next refresh |
| K6 | (power loss) Once a refresh has returned, every power-loss state is exactly the new state, without reset marker |

Measured on Linux (Node 22, ext4/overlay in a container, as superuser; the same
tests passed in CI on `ubuntu-latest` as an unprivileged user, run 42798074801):

| Matrix | Points | Result |
| --- | --- | --- |
| Single kill, update v2->v3 | 20 | K1-K5 hold; 6 old / 12 between / 2 new |
| Single kill, rotation with reset (C2) | 33 | K1-K5 hold; 11 / 20 / 2 |
| Single kill, rotation over targets floor 99999 (C3) | 33 | K1-K5 hold; 11 / 20 / 2 |
| Double kill (second kill inside the recovery), C2, every third recovery step and the last | 162 recovery kills from 16 distinct first-kill states | K1-K5 hold |
| Double kill, all scenarios, every recovery step (`BROWSER_TUF_CRASH_EXHAUSTIVE=1`, 232 s) | 186 + 451 + 478 = 1,115 recovery kills from 10 + 16 + 17 distinct first-kill states | K1-K5 hold; states after the second kill 160 old / 875 between / 80 new |
| Kill during the bootstrap (`initClient`) | 9 | no torn root; re-init completes an absent root, refuses a present one; first refresh verifies and sweeps temps |
| Power loss (model), three scenarios | 18 + 32 + 32 operations, 10 + 16 + 17 distinct states | K1-K6 hold; one state after return each, the new one |

The matrices run in `node --test tests/tuf/*.test.js` (about one minute), skipped
on Windows, where a process cannot SIGKILL itself in the same way. Every trace also
passes a drift guard: each role-file replacement must show create, write, fsync,
rename and the directory fsync, and a marker removal its directory fsync, so a hook
that stops seeing a step kind fails the run instead of silently shrinking it.

The matrix found two defects, both fixed with it:

- **K5:** `atomicWriteFile` removes its temp in `finally`, which a killed process
  never reaches. Every kill between `create` and `rename` left a
  `.<role>.json.tmp-<pid>-<n>` file that nothing ever removed. `refreshClient()`
  now starts with `sweepStaleTempFiles()`: exact client temp names of trusted-state
  files only, only for a pid that is not running (ESRCH; EPERM counts as running),
  only regular files checked without following links. The removed names are
  returned as `staleTempsRemoved`. Liveness is judged in the reader's pid
  namespace: in a directory shared between containers a live writer elsewhere can
  look dead, and its refresh then fails closed at its rename (ENOENT).
- **K2:** a refresh killed between `timestamp.json` and `snapshot.json` was refused
  by the read-back with the verifier's `METADATA_HASH`, a pin mismatch, instead of
  the documented `PERSISTED_STATE_UNVERIFIED`. The read-back now reports one code
  for "not one verifiable chain" and keeps the verifier's code as `details.cause`.

Mutants that the matrices must catch (mutation study, `env: BROWSER_TUF_KILL_MATRIX`):
`client-write-in-place` (truncate and rewrite instead of rename; K1),
`client-stale-temps-kept` (K5), `client-readback-leaks-verifier-code` (K2, caught by
the kill matrix only), and three that only a power cut can expose:
`client-write-without-file-fsync` (empty role file, K1),
`client-write-without-directory-fsync` (committed state lost after return, K6) and
`client-marker-removal-not-durable` (reset marker back after return, K6). The
power-loss matrix catches these three through its contract; the kill matrix catches
them only through its drift guard (a step kind is missing), never through K1-K5,
which is the reason the model exists.
