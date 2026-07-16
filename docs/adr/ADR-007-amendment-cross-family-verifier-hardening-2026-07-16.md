# ADR-007 Amendment — CWAP / Signed-Package Verifier: Normative Hardening Requirements

- Status: PROPOSED (feeds the #24 spike; not yet implemented)
- Date: 2026-07-16
- Source: Cross-family review 007acc (Gemini deep code-review + ChatGPT process/gate review),
  vetted by Vero against repo ground truth.
- Relates to: ADR-007, ADR-005, issue #24 (package/secure-update spike), issue #23 (runtime spike)

## Ground-truth caveat (read first)

No `verify.py` / CWAP verifier exists in the repo yet — #24 is an **unbuilt spike**. The
cross-family review elaborated concrete Python snippets against a **non-existent** implementation
(referenced line numbers and a "41/41 tests" corpus that are not in this repo, and at least one
uncertain API, `zipfile.start_dir`). Therefore the items below are **normative requirements for
the future build**, not verified running code. At implementation: confirm exact APIs and cover
**every** rule with an adversarial test. This amendment is the durable knowledge; the code is
illustrative only.

## A. Container (ZIP) — reject on violation

1. **No archive comment** — EOCD comment MUST be empty (parser-confusion vector).
2. **No encryption** — general-purpose flag bit `0x1` set → REJECT.
3. **No ZIP64** — package ≤ 256 MiB; any 32/64-bit header inconsistency → REJECT.
4. **No prepended data / SFX** — archive MUST begin at offset 0; any bytes before the first Local
   File Header → REJECT. (Detect via "first LFH at offset 0", not an unverified library attribute.)
5. **No data descriptors / streaming ZIPs, no multi-disk archives.**
6. **CDH↔LFH consistency (anti-"Babel"/parser-differential)** — for each entry the filename,
   compressed size and uncompressed size in the Central Directory MUST equal the Local File
   Header; any mismatch → REJECT.
7. **No overlapping payload regions** (quoted-overlap zip-bomb class; cf. CVE-2024-0450 — re-confirm
   at impl). Compute real data offsets from the LFH and use an O(N log N) interval-sort overlap
   check (not O(N²)).
8. **Path safety** — no directory entries, no symlinks (external-attr mode check), no
   absolute/traversal/UNC/device paths, no duplicate or Unicode/case-collision names.

## B. Manifest canonicalization (RFC 8785 / JCS) — deterministic cross-language signatures

9. UTF-8, **no ASCII escaping** (`\uXXXX` for non-ASCII is forbidden).
10. Object keys sorted by **UTF-16 code units**, NOT Unicode code points — critical: Python's
    default code-point sort diverges from JS/Rust for chars > U+FFFF and silently breaks signatures.
11. **Float ban** — numeric values MUST be integers; float/NaN/Infinity → REJECT (IEEE-754/Ryu
    serialization diverges across languages → signature mismatch).
12. **JSON depth limit** (e.g. ≤ 5) → nesting-DoS guard.
13. **Strict-but-extensible** — optional `extensions: {}` object; unknown keys allowed ONLY inside
    it, still canonicalized and signature-bound, float-ban still applies; unknown **root** keys →
    REJECT. Optionally: unknown `critical_`-prefixed extension keys → REJECT.

## C. Signature & crypto

14. **Ed25519 strict** — reject non-canonical scalar `S ≥ ℓ` (SUF-CMA; e.g. `verify_strict` /
    ed25519-dalek strict). Prevents malleable-but-valid signatures if package hashes are ever
    logged/blocklisted.
15. Signature verified **before** any payload parsing/extraction (keep existing strength).

## D. Filesystem / activation safety

16. **TOCTOU** — stat via the open file descriptor (`fstat`), never path-stat-then-open.
17. **Atomic staging** — staging dir MUST be on the same mount as `install_root`
    (e.g. `<install_root>/.staging`) so `rename`/`os.replace` is an atomic inode swap; never `/tmp`.
18. **Strict path containment at extraction** — resolve the final path and assert it is inside the
    staging sandbox (`resolved.is_relative_to(sandbox)`), independent of string-level checks.
19. Keep last-good version for rollback; hard-delete rotated-out versions (retention / purpose-binding).

## E. Process & verification gates

20. Normative spec **before** code; one canonical manifest representation; limits enforced **before**
    allocation/extraction.
21. **Differential-test gate (mandatory 007 gate)** — two independent implementations (Python
    reference + Rust: `rc-zip` + `serde_json` + `ed25519-dalek`) run against the same adversarial
    corpus **plus** mutation fuzzing; ANY verdict mismatch = fail.
22. Keep these five questions **separate** (a valid signature answers only #1): package
    integrity/identity · publisher admission · capability approval · secure-update authority ·
    code-safety.
23. Test update/rollback/replay/freeze/key-rotation/revocation/recovery; separate metadata-trust
    from package-trust; use **TUF** as reference model.

## Confidence

High for A1–A8, B9–B11, C14–C15, D16–D18, E20–E23 (primary-source or well-known archive-parser /
crypto hygiene). Medium for B12/B13/D19 (design choices — fix exact limits at implementation).

## F. Verification, corrections & additional required classes (Quella primary-source cross-check, 2026-07-17)

**Corrections to items above (web-verified — supersede the originals):**
- **C14 (Ed25519) reworded:** rejecting non-canonical scalar `S ≥ ℓ` is done by BOTH `verify` and
  `verify_strict` and only removes *scalar* malleability — necessary but NOT sufficient, and NOT
  what distinguishes strict mode. Require `ed25519-dalek::verify_strict` = cofactorless verification
  **plus** rejection of non-canonical/small-order encodings of **R and the public key A** (strong
  binding / SBS). Refs: docs.rs ed25519-dalek; "Taming the many EdDSAs" ePrint 2020/1244.
- **B11 (float-ban) tightened:** sound ONLY together with a **safe-integer magnitude cap `|n| < 2^53`**;
  a larger "integer" is an IEEE-754 double under the hood and re-introduces the serialization
  divergence JCS avoids.
- **A7 (CVE-2024-0450) scope caveat:** covers ONLY overlapping-entry bombs (CPython fixed 3.12.3/
  3.11.9/3.10.14/3.9.19/3.8.19). It does NOT defend ratio/aggregate-size bombs — do not cite it as
  general zip-bomb coverage.

**Additional REJECT / control requirements (were missing):**
- **A9. Decompression bombs (biggest gap):** hard cap on total uncompressed bytes + per-entry ratio
  cap + **streamed extraction with a byte ceiling** (abort mid-stream; never trust declared sizes).
- **A10. Compression-method allowlist:** store(0)+deflate(8) ONLY; reject bzip2/LZMA/zstd/PPMd/deflate64.
- **A11. Entry-count / central-directory-size cap** (millions of tiny entries = exhaustion bomb).
- **A12. Extra-field filename override:** Info-ZIP Unicode-Path (0x7075) and 0x000a/0x5455 extra fields
  can override the header name → traversal/sanitization bypass. Strip/ignore all non-essential extra
  fields OR validate them against the sanitized main name.
- **A13. POSIX mode / external-attr bits:** normalize/strip setuid/setgid/sticky/exec bits + mtime on
  extraction (never honor from archive).
- **A14. Windows filename edge cases (explicit):** reserved device names (CON, PRN, AUX, NUL, COM1–9,
  LPT1–9, incl. with extension), trailing dot/space, NTFS ADS (`name:stream`), MAX_PATH(260) overflow.
- **A15. Integer-overflow guard** in size/offset arithmetic (validate against real file length, even
  with ZIP64 banned).
- **B14. Manifest parser hardening:** duplicate-key → REJECT; reject NUL/BOM/non-UTF-8 at parse
  (separate from the UTF-16-sort rule).
- **B15. Signature scope + manifest↔payload bijection (top-tier supply-chain):** define explicitly WHAT
  is signed. If only the manifest is signed, require a per-file content hash in the manifest AND a
  bijective check (every ZIP entry ∈ manifest and vice-versa) — else unlisted files can be added/swapped.
- **E24. Secure-update freshness (TUF):** Ed25519 proves only blob authenticity — add a monotonic
  version counter (anti-downgrade), signed expiry/timestamp (anti-freeze/replay), and key-rotation/
  revocation + role/threshold. MAJOR class for a signed-update format.

Provenance: corrections/confirmations are web primary-source verified (RFC 8785, CVE-2024-0450
advisory, ed25519-dalek docs + ePrint 2020/1244, Chrome IWA docs, Electron timelines); the gap list
is our analysis on those facts. IWA/.swbn confirmed ChromeOS/enterprise-gated → rolling our own CWAP
is defensible, not reinventing a portable standard.

## G. Second adversarial validation pass (Aegis primary-source, 2026-07-17) — corrections + signing-layer additions

A second, independent adversarial re-validation against 2025–2026 primary sources found **6 defects in
the rules above (4 factual, 2 insufficient-control)** and **the largest remaining blind spot: the
document hardened the CONTAINER thoroughly but under-specified the CRYPTOGRAPHIC BINDING (which bytes
are signed) — where a signed-package format lives or dies.** These items SUPERSEDE the earlier wording.

**Corrections (supersede A/C/E/§F above):**
- **A6 (CDH↔LFH) — was insufficient.** Comparing filename+comp/uncomp size is NOT enough. CDH and LFH
  MUST agree byte-for-byte ALSO on **CRC-32, compression method, and the full general-purpose bit-flag
  word**; plus a **LFH↔CDH bijection** (exactly one LFH per CD entry, no orphan/shadow LFHs) and reject
  trailing bytes after an entry's compressed stream that are not the next LFH. Ref: GHSA-w97x-xxj5-gpjx
  (Python-wheel ZIP parser-differential v2, disclosed 2026-01-22); CVE-2025-54368 (stacked/multi-local-entry).
- **A12 (extra-field name override) — misclassified.** Only **0x7075 (Info-ZIP Unicode Path)** and
  **0x6375 (Unicode Comment)** override the name/comment. **0x000a (NTFS) and 0x5455 (ext-timestamp) are
  TIMESTAMP fields → they belong under A13 (mtime normalisation), NOT filename override.** Rule: strip/reject
  all filename-bearing extra fields (0x7075, 0x6375) and derive the name from a single source. Ref: libzip
  extrafld.txt; GHSA-w97x (uv used 0x7075, pip used LFH name → filename swap).
- **A3 (ZIP64 ban) — add sentinel rejection.** Also REJECT if any size/offset field == `0xFFFFFFFF` or any
  count field == `0xFFFF` (ZIP64 sentinels), even with no ZIP64 extra field — closes the sentinel-driven
  parser-differential. Ref: APPNOTE 6.3.9 §4.5.
- **C14 (Ed25519 strict) — drop the cofactor claim.** docs.rs documents `verify_strict` as *cofactored*
  while the impl is cofactorless (contested: curve25519-dalek#663) — cofactor treatment is NOT the
  security distinguisher and is version-dependent; do not put it in a normative rule. Correct: strict mode's
  guarantee over `verify` is **rejection of small-order / non-canonically-encoded public key `A` and
  small-order `R`** → Strongly-Binding Signature (SBS). (Both `verify` and `verify_strict` reject `S ≥ ℓ`.)
  Pin the curve25519-dalek version. Refs: docs.rs VerifyingKey; curve25519-dalek#663; ePrint 2020/1244.
- **D18 (path containment) — was insufficient as sole control (check-then-use race).** `resolve()+is_relative_to()`
  is an advisory STRING check; the write happens later (CVE-2025-29787, Rust `zip` ≤2.2.x, fixed 2.3.0).
  Require: (1) create the staging tree into a freshly-made, exclusively-owned dir no attacker can pre-seed;
  (2) open each path component with reparse-point-FAILING semantics (Windows `FILE_FLAG_OPEN_REPARSE_POINT`
  + reject reparse; POSIX `O_NOFOLLOW` per component / `openat2 RESOLVE_BENEATH`); (3) re-verify containment on
  the OPENED fd (`GetFinalPathNameByHandle`/fstat), not a pre-open string; (4) never write through a
  junction/symlink component. Also covers Windows 8.3 short-names, ADS, trailing-dot/space, `\\?\` bypass.
- **E21 (differential gate) — zipfile is a poor sole reference oracle.** CPython `zipfile` is itself
  implicated in these differentials. Run **≥3 version-pinned parsers** (e.g. `zipfile ≥3.12.2`, `rc-zip`, and
  one of libzip/yauzl), each treated as fallible; the gate = our ACCEPTED set is a strict subset on which
  ALL parsers agree (name/order/bytes), not "two verdicts match". Track RUSTSEC/CVE feeds (zip-crate ≥2.3.0
  if used anywhere). NB `rc-zip` (sans-io, CD-first) had no equivalent RUSTSEC advisory at review — an
  absence of evidence, not a safety proof.
- **§F A7 versions — WRONG, re-pin.** CVE-2024-0450 was fixed in CPython **3.12.2 / 3.11.8** / 3.10.14 /
  3.9.19 / 3.8.19 (not 3.12.3/3.11.9). Ref: python.org security-announce thread.
- **B11 rationale — reword (rule stays).** Floats are banned NOT because conformant JCS impls diverge
  (they must not — that is JCS's purpose) but because **few libraries implement the RFC-8785 number
  algorithm correctly**; the `|n| < 2^53` cap (RFC 7493 I-JSON) sidesteps that conformance gap.

**Signing-layer additions (the under-specified core — new REJECT/control rules):**
- **G1. Signed-byte definition (bomb-swap gap — biggest).** B15 requires per-file hashes+bijection but never
  says WHICH bytes are hashed. Hashing decompressed content lets an attacker swap a `store`d file for a
  `deflate` bomb at the same content-hash. Rule: bind **compression-method + compressed-size + ratio** into
  the signed manifest alongside the content hash, OR hash the whole canonical container tail (Merkle/whole-
  archive) so the representation cannot be swapped under a fixed identity.
- **G2. Algorithm pinning (anti-downgrade / `alg:none`).** The verifier HARDCODES the sig+hash algorithm set
  (Ed25519 + one fixed hash); any `alg`/`hash` field read from the package that is absent or ≠ the pinned
  value → REJECT. The package never selects crypto.
- **G3. On-wire manifest canonicality.** REJECT unless the on-wire manifest bytes are byte-identical to their
  own JCS output; verify the signature over exactly those bytes; never re-canonicalise-then-trust (parse/
  serialise confusion).
- **G4. Capability-escalation-on-update gate.** Diff the update's capability set against the installed version;
  any escalation → explicit re-consent. A valid signature never auto-grants new capabilities.
- **G5. Publisher-key ↔ app-id binding.** The signed manifest MUST carry the app-id inside the signed region;
  the verifier pins app-id → authorised key(s) (TOFU) and rejects a valid signature from a non-pinned key for
  that app-id (blocks cross-app install + second-publisher shadowing).
- **G6. Anti-stacking completeness.** Beyond A4/A7: assert EOCD is the LAST bytes (no trailing data), contiguous
  entry layout with no unaccounted gaps, and CD offset+size lands exactly at EOCD. Ref: CVE-2025-54368.
- **G7. Manifest pre-parse byte cap** before `json.loads` (parse-time DoS).
- **G8. Offline-clock caveat on E24.** An offline app has no trusted clock, so signed-expiry (anti-freeze) is
  best-effort only; the **monotonic version counter is the robust anti-downgrade primitive** — do not over-trust expiry.

Provenance G: primary-source verified — RFC 8785 §3.2.3/§3.2.2 + RFC 7493; docs.rs ed25519-dalek +
curve25519-dalek#663 + ePrint 2020/1244; GHSA-w97x-xxj5-gpjx (2026-01-22); CVE-2025-54368 (uv/PyPI 2025-08);
CVE-2025-29787 (Rust zip, fixed 2.3.0); python.org CVE-2024-0450 thread; libzip extrafld.txt; APPNOTE 6.3.9;
Fifield "A better zip bomb" WOOT'19; bugs.python.org 38671. Signing-layer rules G1–G8 are our analysis on those
facts. Net: container layer strong; **the signing/binding semantics were the real gap and are now specified.**
