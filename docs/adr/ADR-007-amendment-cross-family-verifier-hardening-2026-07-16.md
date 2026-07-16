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
