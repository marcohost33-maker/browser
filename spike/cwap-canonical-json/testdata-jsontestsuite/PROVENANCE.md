# JSONTestSuite — vendored external parser-conformance oracle

- Source: https://github.com/nst/JSONTestSuite ("Parsing JSON is a Minefield",
  Nicolas Seriot). `test_parsing/` — 318 files.
- Pinned commit: `1ef36fa01286573e846ac449e8683f8833c5b26a` (fetched 2026-07-19).
- License: MIT (see `LICENSE`). Vendored verbatim (byte-exact, `-text`) for an
  offline, reproducible, tamper-proof CI gate — consistent with
  `../testdata-rfc8785/`.

## Why vendored (not curl-from-master)

The r2 audit package fetched this suite via `curl … /refs/heads/master` — a moving,
unpinned target (supply-chain + non-determinism). Vendoring at a pinned commit makes
the conformance gate offline and reproducible for a signature-security component.

## Semantics (see `../jts_harness.py`)

- `y_*` (RFC-8259-valid): all 3 impls agree; ACCEPT, or REJECT only with a
  CWAP-*semantic* code (FLOAT_FORBIDDEN, INT_OUT_OF_SAFE_RANGE, NONFINITE_FORBIDDEN,
  DUPLICATE_KEY, LONE_SURROGATE, DEPTH_EXCEEDED). An INVALID_JSON/INVALID_UTF8 on a
  `y_` file would be a parser bug → FAIL.
- `n_*` (must-invalid): all 3 impls agree + REJECT (any code).
- `i_*` (implementation-defined): 3-way agreement suffices.

Result 2026-07-19: **318/318 GREEN** (0 y-bugs, 0 n-bugs, 0 divergences).
