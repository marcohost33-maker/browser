# Cross-Family Adjudication — browser runtime, null-egress, CWAP-F6, platform contract

- Date: 2026-07-22
- Adjudicator: Vero (Claude Opus 4.8), owner-side. **This is Vero's adjudication, not an
  independent cross-family certificate.**
- Inputs (external, other model families — Same-Family self-cert avoided):
  - **ChatGPT** browser cross-family review — STATUS: DONE / ADVISORY / FAIL-CLOSED.
    Source (Drive 007acc): `2026-07-22_007_ANTWORT_browser-cross-family-review_ChatGPT`
    + `LOG_NACHTRAG` (REF-ID `2026-07-22-BROWSER-CROSS-FAMILY-REVIEW-CHATGPT`).
  - **Gemini** "Verosystem & HexForge Architecture Update V2" (11:45 UTC).
    Adjudication: `2026-07-22_007_RUECKMELDUNG_verosystem-hexforge-architecture-update-v2_Vero-an-Gemini.md`.
- Purpose: bind the external advisories **into this repo** (they previously lived only in
  Drive) and record which recommendations are accepted, deferred, or rejected — with the
  ground-truth each rests on.

## 1. ChatGPT browser review — ACCEPTED as advisory, fail-closed for promotion

ChatGPT's executive verdict: continue the browser project but with a **narrower security
claim**. Electron is a sound reference runtime for T2 and the existing harness, but **not
a sufficient security boundary for arbitrary hostile T3 content** — T3 additionally needs
outer OS/container/VM isolation, a kernel-level null-egress policy, hard resource limits,
and independent observation. Accepted verbatim into the T3 posture (aligns with ADR-005
keeping T3 fail-closed and ADR-006 staying PROPOSED).

Adjudicated dispositions:

| ChatGPT point | Disposition | Where it lands |
|---|---|---|
| F1 — T3 not a hardened Electron window; needs outer OS/VM isolation, T3-Linux experimental first (gVisor `--network=none` / netns, read-only mounts, Landlock/seccomp, cgroups, external watchdog) | **ACCEPTED (direction)**; **DEFERRED (build)** — Linux-only, not producible on the Windows box | ADR-006 runtime matrix; #23 T3 spike |
| F1 — re-cut product tiers T1 / T1.5 (Wasm component) / T2 / T2.5 / T3-Linux-exp / T3-cross | **ACCEPTED as refinement** of ADR-005's T1→T2→T3 staging | feeds ADR-005 follow-up |
| F2 — current null-egress proof is PARTIAL (only observed Chromium requests of the specific harness; not kernel-wide TCP/UDP/DNS/RAW across the whole Electron process tree, no WebRTC STUN/TURN, no post-escape exfil) | **ACCEPTED**; the 12/12 harness result is *evidence*, not a kernel-wide egress proof | see §3 (provenance) + ADR-006 |
| CWAP-F6 not promotable without extra norms (strict UTF-8/lone surrogates, number-lexing, host-independent duplicate detection, resource limits); closing `}` as DUPLICATE_KEY report point + EOF rule **confirmed** | **ACCEPTED**; F6 stays fail-closed (Track B); the 5 norm-addendum sentences (Drive) address exactly this | CWAP-F6 addendum, `browser` spec anchor |
| Platform contract: Signed Package + Capability Manifest + Evidence Record + WIT World; MCP only an optional northbound adapter | **ACCEPTED as contract basis** | ADR-007 (#24) two-track spike; resolves part of the two-contracts ambiguity |
| **Stop-the-line:** Drive evidence names both **11/12** and **12/12**; bind run provenance before any promotion | **ACCEPTED** — reconciled in §3 | this record |

## 2. Gemini "Architecture Update V2" — REJECTED as-specified (wrong premise / wrong layer)

Full evidence in the Drive Rückmeldung. Summary of the owner-side verdict:

- **HexForge R7 (InstancedMesh vs BatchedMesh + BVH raycasting + per-instance frustum
  culling): REJECTED.** Ground-truth against the real renderer (`hexforge-studio`,
  `index.html` @ `0d4f319`): 0× InstancedMesh, 0× BatchedMesh, 0× three-mesh-bvh; HexForge
  is a **line renderer** (`LineSegments2` fat-lines + `LineSegments`, batched per family)
  — not thousands of solid hex meshes. The proposal assumes an architecture that does not
  exist; implementing it would rewrite a shipped, working renderer (non-degradation).
  *(Recorded here only because Gemini's doc is titled to also cover the Verosystem/browser
  security layer; the HexForge part does not touch this repo.)*
- **"WASM-enforced" Codie-Scout system prompt: REJECTED** as security-by-declaration.
  codie-scout is an LLM subagent with Read/Grep/Glob only — no exec/network runtime to
  escape. A prompt claiming kernel enforcement that is not enforced is exactly the
  security-by-declaration anti-pattern. Real least-privilege is already enforced by
  tool-binding.
- **Valid kernel-isolation direction is correctly located elsewhere** — the code-executing
  layers: `nigin-offline-core` runtime (Landlock/seccomp design, decided 2026-07-22) and
  `browser` **T3** (this repo). Not in agent prompts. This *reinforces* ChatGPT F1.

Net: Gemini V2 contributes no repo change here; its only browser-relevant effect is to
independently confirm that hostile-content isolation belongs at the runtime/kernel layer
(ChatGPT F1), not at a declaration layer.

## 3. Provenance reconciliation — the 11/12 vs 12/12 stop-the-line

ChatGPT correctly flagged that Drive evidence shows both counts. Reconciliation from
ground-truth:

- **11/12** was the **pre-fix** harness run: one probe (`cachestorage`) deviated due to a
  latent payload bug (`Cache.put` on a custom scheme → `TypeError`, reproducible in real
  Chrome too).
- **12/12** is the **post-fix, current authoritative** run: after the cachestorage fix
  (https-key + explicit Response, no network), all probes are as-expected, deviations = 0.
  Current file `spike/runtime-eval/harness/electron/RESULTS_WINDOWS_2026-07-22.md`
  (`:19` "12 / 12", `:69` "deviations = 0").

**Binding requirement for any future promotion** (accepted from ChatGPT): every reported
result row must carry immutable run provenance — commit SHA + run-id + harness/payload/
policy/result hashes — so "11/12" and "12/12" can never again be ambiguous. Until such a
provenance-bound row exists, the Electron/Windows result stays **evidence, not a
promotion gate**, and all T3/CWAP promotions remain fail-closed.

## 4. Open, correctly deferred (not silently dropped)

- T3-Linux null-egress spike (gVisor/netns/Landlock/seccomp/watchdog) — Linux-only, #23.
- Kernel-wide egress proof incl. WebRTC STUN/TURN + post-escape — needs the outer layer.
- CEF fallback + macOS/Linux runtime rows for the ADR-006 matrix.
- Product tier re-cut (T1.5/T2.5) into ADR-005 follow-up.
- CWAP-F6 5-sentence addendum ratification (needs the still-pending Gemini F6 vote;
  ChatGPT F6 vote is in and confirms the closing-`}`/EOF rules).

---
*All dispositions rest on tool-verified ground-truth (git/grep/file:line against this repo
and `hexforge-studio@0d4f319`). External advisories are advisory; promotions stay
fail-closed. This record is the repo-side anchor for the Drive 007acc exchange.*
