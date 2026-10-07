# Spike: Coupled Update Transaction (TUF metadata + package activation)

- Status: **executable research spike; not an updater, installer or runtime**
- Parents: [ADR-009](../../docs/adr/ADR-009-tuf-update-metadata-evaluation.md)
  ("atomic metadata/package activation interruption matrix") and
  [ADR-007a](../../docs/adr/ADR-007a-signed-package-verifier-hardening.md) section 6, issue #24
- Builds on: [`spike/tuf-offline-metadata/`](../tuf-offline-metadata/) (verification) and
  [`spike/activation-store/`](../activation-store/) (persistence)
- Runtime dependencies: none (Node.js standard library only)
- Network access: none
- Package format: **none selected**. The verified target is staged as one opaque,
  content-addressed object (register D4 stays open)

## Purpose

The stateful TUF client persists `root.json`, `timestamp.json`, `snapshot.json` and
`targets.json` one file at a time. Each write is crash-safe, but the set is not one
transaction, and nothing ties it to the package that is running. Two special cases in
[`client-core.mjs`](../tuf-offline-metadata/client/client-core.mjs) exist only to repair
torn states after a crash:

- the TUF 5.3.11 rotation reset on load;
- the resume from the trusted timestamp.

ADR-009 also requires that the client "never advance trusted metadata state without also
preserving a recoverable installation state". This spike answers the persistence-model
question from the review backlog: role-by-role files, or one compare-and-swap generation
with a single atomic `CURRENT` pointer. It builds the second option and measures it.

## Design

```text
activation store commit (state/CURRENT, one atomic rename)
  active, previous                       -> content-addressed version records
  bindings:
    update/root         exact bytes of the newest accepted root
    update/timestamp    exact bytes as received
    update/snapshot     exact bytes as received
    update/targets      exact bytes as received
    update/trust-state  canonical record: app id, version, digest, approved capabilities, decision
version record (immutable)
  resources: package    the verified target bytes, one opaque object
  bindings:  update/target   canonical record of what authorised this version
```

### One transaction per update

`applyOfflineUpdate()` = `planOfflineUpdate()` + exactly one commit:

1. **Load.** Read the bindings of the current commit (generation G) through
   `readCommitBindings()`, which never mixes two commits.
2. **Re-verify the bound state.** Re-verify every bound role from its exact bytes (see
   [Fail-closed loading](#fail-closed-loading)).
3. **Verify the bundle** with `verifyOfflineBundleBytes()`. This is the unchanged
   generic TUF core plus the Browser policy: app identity, monotonic version, no version
   reuse, and explicit consent for every capability expansion, including the initial set
   at first install.
4. **Commit by plan kind.** Each commit is a compare-and-swap on G.

   | Plan kind | Write |
   |---|---|
   | `activate` (new app version) | stage the verifier's private copy of the target, then **one** `activate` that names the new version and binds root, timestamp, snapshot, targets and trust state |
   | `bind` (same version and bytes, newer metadata) | **one** `commitBindings`; the active version is untouched, so a local rollback stays in force |
   | `root-only` (newer root, unchanged timestamp) | the bound chain must still verify under the new root, otherwise `RETAINED_METADATA_INVALID`; then **one** `commitBindings` |
   | `none` | nothing is written |

A crash anywhere leaves the commit of G or of G + 1, never a mixture. A concurrent writer
turns the commit into `GENERATION_CONFLICT` instead of being overwritten. Staging before
the commit only adds unreferenced objects, which recovery collects.

### Fail-closed loading

`loadUpdateState()` re-parses the bound root from its bytes and requires a threshold of
its own keys.

It then runs the bound timestamp, snapshot and targets through the generic verifier with
zero rollback floors. That re-checks:

- signatures and thresholds;
- roles and spec version;
- the timestamp→snapshot and snapshot→targets version, length and hash pins, over the
  bound bytes;
- every signed target path.

**Freshness is deliberately not evaluated.** An installed app must keep starting offline
after its metadata expired (ADR-009 disabled-update mode). Incoming bundles are still
checked for expiry. The trust state must be authorised by the bound targets metadata:
same path, digest, app id, version and capability set.

Because every commit binds a complete, internally verified chain, a chain that does not
verify can only come from damage or tampering, never from a crash. It therefore fails
closed (`UPDATE_STATE_INVALID` with the verifier's cause) and is **not** reset. The two
torn-state repairs of the role-by-role client are unnecessary here by construction.

### Rollback and start-up

`rollbackPackage()` uses the store's rollback. The store carries every commit binding
forward, so the update metadata, the trust state and all rollback floors stay in place. A
local rollback is an owner decision about which verified package runs. It never
downgrades what the client has seen.

`verifyInstalledState()` is the start-up check: no network and no clock. It runs:

- the bound-state check above;
- the store's full re-hash of the active version;
- the active version's own `update/target` record.

The result is `current`, or `rolled-back` (an older version this state authorised). It
also returns the capabilities approved **for the version that is active**: after a
rollback, those are v1's capabilities, not v2's.

### Store additions

The coupling needed the read side of bindings in
[`activation-store.js`](../activation-store/activation-store.js). The store's commit
protocol is unchanged.

- `readCommitBindings()` returns every binding of one commit, each re-hashed. When an
  object vanished because a concurrent commit and collection moved the generation, it
  reads again once, as the serving path does.
- `readVersionBindings(versionId)` returns the bindings of one immutable version record.

The activation-store crash-matrix report was regenerated after this change. Only its
source digest changed; every number is byte-identical.

## Evidence

All numbers below come from the committed, source-bound report
[`results/crash-matrix-report.json`](results/crash-matrix-report.json). It is bound to
`update-activation.js`, the scenarios, the TUF fixtures, the activation store and its
harness, and the TUF verifier.

### Crash matrix

The scenarios run through the activation store's own matrix (`runModelMatrix`), so the
persistence models, platform variants and generic invariants are exactly those described in
[`spike/activation-store/README.md`](../activation-store/README.md#crash-matrix).

The generic invariant is that recovery yields exactly the old or the new commit. On top of
that, each scenario's `reconcile` runs `verifyInstalledState()` on the recovered state,
before and after finishing the operation, and checks:

- the expected app version;
- the root, timestamp and targets versions;
- `current` versus `rolled-back`;
- for the metadata refresh, that the active version did not change.

| Scenario | Operation | Mutating calls |
|---|---|---:|
| `coupled-bootstrap` | bind the initial root | 19 |
| `coupled-first-install` | verify and install v1 | 71 |
| `coupled-update` | v1 → v2 | 78 |
| `coupled-update-root-rotation` | v1 → v2 with root v2 rotating the timestamp and snapshot keys | 79 |
| `coupled-metadata-refresh` | newer timestamp/snapshot for v2, package unchanged | 52 |
| `coupled-rollback` | local rollback v2 → v1 | 24 |

| Variant / model | Crash cases | Distinct states | Consistent |
|---|---:|---:|---:|
| directory-sync / process-crash | 329 | 329 | 329 |
| directory-sync / posix-strict | 13,900 | 2,060 | 13,900 |
| directory-sync / ordered-prefix | 1,932 | 193 | 1,932 |
| directory-sync / recovery-crash | 5,297 | 5,297 | 5,297 |
| directory-sync / post-recovery power loss, posix-strict | 14,216 | 1,758 | 14,216 |
| directory-sync / post-recovery power loss, ordered-prefix | 1,588 | 212 | 1,588 |
| no-directory-sync / process-crash | 329 | 329 | 329 |
| no-directory-sync / ordered-prefix | 888 | 193 | 888 |
| no-directory-sync / recovery-crash | 5,297 | 5,297 | 5,297 |
| no-directory-sync / post-recovery power loss, ordered-prefix | 1,588 | 212 | 1,588 |
| no-barrier / process-crash | 329 | 329 | 329 |
| no-barrier / ordered-prefix | 5,617 | 193 | 5,617 |
| no-barrier / recovery-crash | 5,297 | 5,297 | 5,297 |
| no-barrier / post-recovery power loss, ordered-prefix | 8,324 | 1,001 | 8,324 |
| **Total** | **64,931** | | **64,931 (100 %)** |

There are **0** durability violations in every variant with a barrier. On the real Linux
filesystem (ext4, Node adapter), **329/329** process crashes across the six scenarios
recovered consistently. That run depends on the host, so it is printed by
`--real-fs-only` and not committed. The `activation-store-ci` workflow repeats it on
Windows (NTFS) and macOS (APFS).

### Negative control

`two-commit-update` executes the same verified v1 → v2 plan as `coupled-update`, but
commits the metadata first and the package second. Its reconcile finishes with the same
two-commit protocol, so generation counting cannot produce a spurious difference. The
matrix reports it in every variant, and every recorded example is `state-not-old-or-new`:
new metadata next to the old package.

| Variant / model | Violations / crash cases |
|---|---:|
| directory-sync / process-crash | 53 / 100 |
| directory-sync / posix-strict | 3,442 / 5,220 |
| directory-sync / ordered-prefix | 311 / 617 |
| no-directory-sync / process-crash | 53 / 100 |
| no-directory-sync / ordered-prefix | 163 / 282 |
| no-barrier / process-crash | 53 / 100 |
| no-barrier / ordered-prefix | 884 / 2,473 |

On the real filesystem the control also fails: 47 of 100 process crashes are consistent.

### Unit tests and mutation check

[`tests/update-activation/update-activation.test.js`](../../tests/update-activation/update-activation.test.js)
contains 16 tests against a real store. They cover:

- **Bootstrap:** threshold check, refusal to merge two trust domains, foreign bindings
  kept.
- **The single commit:** exact bound bytes, trust state, version record.
- **Consent:** for the first install and for capability expansion.
- **Rejections:** rollback, replay, mix-and-match and substitution, all before anything
  is staged.
- **Input handling:** private copies against mutation by the caller; count and size gates
  before copying, which hold even against views that lie about their length.
- **Concurrency:** `GENERATION_CONFLICT` on a concurrent commit.
- **Root changes:** root rotation, and root-only updates with and without a valid bound
  chain.
- **Rollback:** floors and refreshes after a rollback.
- **Expiry:** incoming bundles versus bound state.
- **Fail-closed loading:** six damaged chains, five unauthorised trust states and one
  non-canonical trust state.
- **Start-up refusals:** an unverified newer package, and a damaged active package.
- **A documented limit** (see below).

[`harness/mutation-check.mjs`](harness/mutation-check.mjs) removes eleven controls one at
a time. Each focused test must pass on the unmutated source first, and each mutation must
make it fail: **11/11 killed**. The check is manual, like the store's own, because it
rewrites a source file that parallel test runs import.

Commands:

```text
node --test "tests/update-activation/*.test.js"
node spike/update-activation/crash-matrix.mjs --write        # rebuild the committed report
node spike/update-activation/crash-matrix.mjs --real-fs-only # host process crashes
node spike/update-activation/harness/mutation-check.mjs
UPDATE_MATRIX_FULL=1 node --test --test-name-pattern "byte for byte" tests/update-activation/crash-matrix.test.js
```

## Limits and open items

- **Start-up cannot tell a local rollback from metadata committed ahead of its package.**
  Both show an older active version under newer trusted metadata. The coupled protocol
  never writes the second state: the crash matrix covers every interruption, and the
  negative control shows the matrix would see it. A dedicated test pins this: start-up
  reports such a state as `rolled-back`, never as `current`. Recording rollback intent in
  the trust state would close it, but that is a policy change, not part of this spike.
- **Consent is recorded only as its result.** The approved capability set is persisted,
  and the version of the consent dialogue is not. ADR-009 asks for both.
- **Top-level targets only.** Delegations are not implemented, and the profile is
  Ed25519 + SHA-256. This is inherited from the TUF spike.
- **Not wired yet.** The stateful TUF CLI (`client/`) still persists role by role. Moving
  it onto this store, or retiring it, is a separate change. Until then, both models exist
  side by side and only this one couples metadata to the package.
- **No container format.** One opaque object per version is storage mode B of the #24
  bake-off plan. A signed resource index for serving belongs to the D4 decision.
- **Power loss is modelled, not measured.** This is inherited from the activation store:
  the NTFS journal hypothesis is a model, and a real power-loss drill is still open.
- **No independent review yet.** This spike needs the same cross-family review round as
  the stack it builds on.

These are acceptance blockers, not future claims.
