# TUF Ed25519 Differential Oracle

This harness compares the Browser project's generic top-level TUF verifier with
an independent maintained implementation, `python-tuf`.

## Scope

The corpus is intentionally profile-faithful:

- TUF metadata version: project POUF pin;
- key type/scheme: Ed25519;
- digest: SHA-256;
- roles: root, timestamp, snapshot, top-level targets;
- exact received metadata bytes are used for descriptor length/hash checks;
- Browser app/capability policy is not part of this comparison.

The harness separates **conformance cases** from **profile observations**.
Conformance cases must produce the same accept/reject decision in both
implementations. Profile observations cover project restrictions that may be
stricter than a general TUF client, such as duplicate JSON-name rejection and
integer-token spelling.

## Independent oracle

CI pins:

- `tuf==7.0.1`;
- `securesystemslib==1.5.1`;
- `urllib3==2.8.0`.

Installation uses only binary wheels and `pip --require-hashes`.

The Python oracle uses `TrustedMetadataSet`, the low-level python-tuf component
that implements the detailed client metadata workflow without repository network
I/O. This is intentionally a research oracle: it is not linked into the Browser
runtime.

## Independent keyid check (#56)

python-tuf does not check that a keyid matches its key, and the corpus generator
derives keyids with the Browser's own `keyIdFor()`/`canonicalBytes()`. A drift in
that formula would therefore pass both decision paths. The Python oracle
recomputes every keyid in every corpus root as
`sha256(securesystemslib.formats.encode_canonical(key))` and reports
`keyid_check`; the comparison fails on any mismatch or on a missing check.

The comparison recomputes the expected root and key totals from the corpus and
requires `roots_checked` and `keys_checked` to equal them, so an oracle that
checks fewer roots or keys cannot pass. It also requires exactly one decision per
corpus case from each oracle (no missing, repeated or unknown case), the oracle
identities `browser-tuf-spike` and `python-tuf`, and the `tuf` version pinned in
`requirements-oracle.txt`.

The corpus also holds one conformance case per top-level role signed with another
role's key: `reject-<role>-signed-by-<key>-key` for timestamp, snapshot and
targets, and two root cases, `reject-root-signed-by-timestampA-snapshotA-keys`
(threshold reached only by keys authorized for other roles) and
`reject-root-signed-by-rootA-and-targetsA-keys` (one root key plus a targets-only
key). All signing keys are in `root.keys`, so only the keyid-to-role binding can
reject them. `tests/tuf/tuf-differential-gates.test.js` runs every corpus case
through the Browser verifier under `npm test` as well.

## Stateful rollback cases and the reason of a rejection

Rollback is a decision against trusted state, so these cases bring both oracles
to the same trusted state first (the default chain at version 2 in every role)
and then offer a candidate that is validly signed and consistent in itself:

| Case | Candidate | Spec step | python-tuf must raise |
|---|---|---|---|
| `reject-timestamp-rollback-against-trusted-state` | timestamp v1 | 5.4.3.1 | `BadVersionNumberError` |
| `reject-snapshot-rollback-against-trusted-state` | timestamp v3 pointing to snapshot v1 | 5.4.3.2 | `BadVersionNumberError` |
| `reject-targets-rollback-against-trusted-state` | timestamp v3, snapshot v3 listing targets v1 | 5.5.5 | `BadVersionNumberError` |
| `reject-root-version-replayed`, `reject-root-version-skipped` | next root with version 1 or 3 instead of 2 | 5.3.5 | `BadVersionNumberError` |
| `accept-newer-chain-over-trusted-state` | v3 in every role (control) | - | accept |

The python oracle loads the stored snapshot the way `ngclient.Updater` does: after
the new timestamp and as `trusted`, so that it stays in the set as the intermediate
snapshot python-tuf takes its targets floor from.

**An agreeing "reject" is not enough.** When these cases were first written
(2026-11-16), the oracle script loaded the stored snapshot before the new
timestamp. python-tuf answered every one of them, the control included, with
`RuntimeError: Cannot update timestamp after snapshot`: a misuse of its API, not a
judgement about the metadata. Two of the three decisions still matched the expected
"reject". Since then a case may name the exception class its rejection must carry
(`expected_python_error`), and `compare-results.mjs` fails any case whose python-tuf
error is an API-misuse class (`RuntimeError`, `TypeError`, `KeyError`,
`AttributeError`, `NameError`). The gate tests forge both situations.

**Since 2026-11-18 (cross-family audit A7-R14) this is a rule, not an option.**
Every reject case names:

- `expected_browser_code`: the Browser error code its rejection must carry;
- for conformance cases, `expected_python_error`: the exact python-tuf class;
- for conformance cases, `positive_control`: an accept case with the same oracle
  setup (trusted root, preloaded timestamp and snapshot, trusted versions, number
  of new roots).

`compare-results.mjs` fails a reject case when a field is missing, when an oracle
gives another reason, or when its control is absent, has another setup, or was not
accepted by both oracles. The python oracle also classifies every exception it
records: only python-tuf's own `RepositoryError` hierarchy (its serialization
errors included) is `category: "repository"`; anything else is `oracle-fault` and
never counts as a rejection, also for profile observations. The timestamp rollback
case got its own control (`accept-newer-timestamp-over-trusted-timestamp`), so the
corpus now holds 24 cases (22 conformance). `generate-corpus.mjs` refuses to write
a reject case without these fields. Seven forgery tests in
`tests/tuf/tuf-differential-gates.test.js` show each rule failing for its own
reason.

Not covered here: fast-forward recovery after a key rotation (5.3.11). python-tuf
does not implement it inside `TrustedMetadataSet`; the old files simply fail
verification under the new root when its `Updater` loads them. That path stays
covered by the client tests (C2 to C6) and the crash matrices, not differentially.

## Mutation evidence

`mutation-study.mjs` applies each mutant as one anchored edit to a temporary copy
of the spike and `tests/tuf`, then runs the unit suite, the Browser differential
and (with `--python`) the python-tuf comparison against that copy. The workflow
runs it with every detector and `--require-all` and uploads
`mutations.json`, which records the source SHA-256 before and after each edit,
the failing tests or cases per detector and the kill status. The study exits
non-zero if the baseline is not clean, a mutant survives, or a mutant only
crashes. Counts are therefore read from that artifact; this README states none.

| Mutant | Expected detector |
|---|---|
| `role-binding-removed` (`role.keyids` check removed) | unit suite, differential |
| `role-binding-skipped-for-root` | unit suite, differential |
| `keyid-non-canonical` (`keyIdFor` hashes `JSON.stringify(key)`) | python-tuf keyid check only |
| `retained-version-binding-removed` (#55 version comparison removed) | unit suite only |
| `client-*` (39 mutants of the stateful client: trusted-state boundary, ancestor rule, canonical IO path, private `mkdir`, 5.3.11 reset marker write/order/removal, C5, read-once and read-back, bounded re-read, stale-temp sweep, in-place write, file/directory fsync, durable marker removal) | unit suite only |

`keyid-non-canonical` shows why the keyid check sits in the oracle: a
self-consistent drift cannot be seen from inside the code under test.

The process-kill matrix (`tests/tuf/tuf-client-process-kill.test.js`, about 17 s)
and the power-loss matrix (`tests/tuf/tuf-client-power-loss.test.js`) run inside
the study only for the mutants that set `env: { BROWSER_TUF_KILL_MATRIX: '1' }`
(in-place write, stale temps kept, verifier code leaked by the read-back, file and
directory fsync, durable marker removal); every other mutant is judged by the suite
without them, and the double-kill matrix never runs in the study (no mutant needs
it), which keeps the study inside the workflow's time budget. The env is recorded
per mutant in `mutations.json`.

For each unit kill the report lists the top-level tests that failed
(`detectors.unit.failed_tests`), so a claim that a named test catches a mutant can
be read from the artifact. The two owner mutants (`client-entry-owner-ignored`,
`client-ancestor-owner-ignored`) are caught end to end only where the suite runs as
the superuser, which can create files owned by another account; unprivileged CI
catches them through the boundary-rule tests on the decision functions.

## Outputs

The workflow emits:

- generated corpus;
- Browser decisions;
- python-tuf decisions;
- machine-readable comparison report;
- mutation report (`mutations.json`).

Any disagreement in a conformance case fails the workflow. Profile observations
are recorded without changing the Browser POUF merely to improve agreement.
