# APP-01 Browser Pull Request

> DRAFT PR body, prepared 2026-07-19. **Not yet opened** — GitHub-budget freeze
> active (no CI-triggering push). Open as **Draft** when the freeze lifts.
> Title suggestion: `spike(cwap): CWAP-Strict-JSON v0.1.2-r1 canonical-JSON core + three-way differential gate (#24)`

## Scope

- [x] This change belongs to APP-01 `browser` and does not move Engine/ENG-01 work into this repository.
- [x] Non-goals and affected trust boundaries are stated.

This adds the canonical-JSON manifest core for the **#24 package/secure-update
spike** (ADR-007 Track B) as an **unbuilt-spike artifact** under
`spike/cwap-canonical-json/`. It is **not** runtime product code and does not
implement a verifier wired into any product path — consistent with
`docs/IMPLEMENTATION_STATUS.md` ("no runtime implemented").

## Change

- Adds the CWAP-Strict-JSON v0.1.2-r1 canonicalization: Python reference (r1
  hardening F-01 LONE_SURROGATE + F-02 structural depth-gate), an independent
  zero-dependency Rust 2nd implementation, and an independent JS 3rd
  implementation (own tokenizer, BigInt).
- Adds the normative decisions **D1–D4** (`SPEC_v0.1.2_DRAFT.md`) and the
  normative error precedence **P1–P4** + MUST rules **F-04** (host-parser ban)
  and **F-05** (BOM trap) (`CWAP_v0.1.2-r1_ADDENDUM_FEHLERPRAEZEDENZ.md`).
- Records the Owner acceptance of D1–D4 + P1–P4 (`DECISION_2026-07-19.md`).
- Adds a deterministic differential corpus + runners and an **advisory**
  (path-filtered, not-required) CI gate `.github/workflows/cwap-differential.yml`.

**Trust-boundary substance:** D2 bans floats/NaN/Infinity and D1 pins JCS UTF-16
key ordering, which removes the RFC-8785 float-formatting cross-language
divergence flagged in ADR-007 amendment §B11/§H *by construction*.

## Risk and privacy

- [x] Security and privacy impact assessed. No network, storage, telemetry or
  rendering path is touched; the spike is offline, stdlib/zero-dependency, and
  parses only in-memory byte buffers.
- [x] Untrusted input paths reviewed: the canonicalizer is the untrusted-input
  surface. It is fail-closed by design (reject codes P1–P4) and fuzz-exercised.
- [x] No new telemetry, remote asset, persistent sensitive storage or broad
  network permission. The CI workflow uses `permissions: {}` + job
  `contents: read`, SHA-pinned actions, `persist-credentials: false`.

## Verification

- [ ] `npm ci --ignore-scripts` — N/A (no npm surface changed by this PR).
- [ ] `npm run csp:check` — N/A.
- [ ] `npm test` — N/A.
- [x] Differential + reference suite pass (see Evidence).
- [ ] Workflow security audit (zizmor) — **must pass in CI**; not runnable
  locally (no wheel for local Python). Workflow mirrors the existing audited
  workflows.
- [x] Negative/regression tests demonstrate fail-closed: reject codes
  INVALID_UTF8 / DEPTH_EXCEEDED / FLOAT_FORBIDDEN / NONFINITE_FORBIDDEN /
  DUPLICATE_KEY / LONE_SURROGATE / INT_OUT_OF_SAFE_RANGE / INVALID_JSON.

## Evidence

Independently re-run by Vero on 2026-07-19 (`VERIFICATION_VERO_2026-07-19.md`),
all Exit 0, all with accept-canon-SHA-256
`2fa3c49a0de37f64441a9e2a0714404cfdf5096d6c418b4cb9a30c86f044be23`:

| Run | Result |
|---|---|
| `test_cwap_v012_r1.py` | 31/31 |
| `differential.py` (Python vs Rust) | 3455/3455 GREEN |
| `differential3.py` (Python vs Rust vs JS) | 3455/3455 GREEN |
| `hypothesis_fuzz.py` (P-1/P-2) | PASS/PASS (1000 examples) |
| Provenance vs `results/sha256.txt` | 12/12 byte-match |

- Owner decision: `DECISION_2026-07-19.md`.
- Relates to: issue #24, `docs/adr/ADR-007-signed-package-evaluation.md`,
  `docs/adr/ADR-007-amendment-cross-family-verifier-hardening-2026-07-16.md`.

## Release and rollback

- [x] Compatibility/migration documented: v0.1.1 → v0.1.2 replaces the custom
  canonical JSON; signatures over v0.1.1 canon bytes stay valid only against a
  v0.1.1 verifier; v0.1.2 verifiers recompute canon bytes and reject v0.1.1
  bytes (version field decides, mixed operation REJECT).
- [x] Safe disablement: this is an isolated spike tree; reverting the commit
  removes it with no product-path impact.
- [x] Public-facing claims do not exceed verified behavior. **Promotion of #24
  stays fail-closed**; open gates before promotion: make the differential a
  *required* check, and wire the canonicalizer into an actual verifier with the
  migration guard. This PR does none of that.
