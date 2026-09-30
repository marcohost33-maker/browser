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

## Outputs

The workflow emits:

- generated corpus;
- Browser decisions;
- python-tuf decisions;
- machine-readable comparison report.

Any disagreement in a conformance case fails the workflow. Profile observations
are recorded without changing the Browser POUF merely to improve agreement.
