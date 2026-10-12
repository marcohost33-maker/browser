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

`keyid-non-canonical` shows why the keyid check sits in the oracle: a
self-consistent drift cannot be seen from inside the code under test.

## Outputs

The workflow emits:

- generated corpus;
- Browser decisions;
- python-tuf decisions;
- machine-readable comparison report;
- mutation report (`mutations.json`).

Any disagreement in a conformance case fails the workflow. Profile observations
are recorded without changing the Browser POUF merely to improve agreement.
