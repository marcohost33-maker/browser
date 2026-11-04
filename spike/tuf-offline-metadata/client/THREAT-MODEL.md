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
5. `fstat` again: size, mtime and ctime unchanged.
6. Return those bytes. There is no second open of the path.

`readTrustedRoleFiles()` also compares the directory's `dev`/`ino` before and after
all role files, so the files of two directory instances are never verified as one
state.

After a refresh, and before `download` authorises a target, `loadVerifiedChain()`
reads everything once more this way and runs the full chain through the core verifier
from those bytes, without any retained floor. After an update, the digests must equal
the files that were verified. This re-verification catches a disk that does not hold
what was verified. It does not prove the disk will still hold it a moment later.

| Result | Meaning |
| --- | --- |
| `INSECURE_LOCAL_STATE` | The object breaks the account rule, or became a link between check and open |
| `LOCAL_STATE_CHANGED` | Another rule-conforming object or changed content. A concurrent atomic replacement looks the same, so this names no cause |
| `PERSISTED_STATE_UNVERIFIED` | The disk after a run is not one complete chain, or not the verified bytes |

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
- **Crash testing is simulated:** failures are injected before each rename and at the
  marker removal. A real process kill or power loss has not been measured.

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
