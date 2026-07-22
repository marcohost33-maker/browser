# Program Critical Path — three-layer stack

- Status: PLANNING NOTE (not a decision). Owner of all selections: Marco.
- Date: 2026-07-22
- Author: Codie. **Not self-certified — Equalita/Data review open.**
- Scope: the critical path across `browser` (runtime) · `nigin-engine` (contract
  core) · `browser-nigin` (AI layer). Repo facts below were verified against this
  repo's git/`gh` state on 2026-07-22; where a fact could not be verified locally it
  is marked as such.

## Purpose

Name, in one place, what actually gates near-term progress for `browser` and what
does not — so effort is not spent building against a contract that neither exists nor
is yet needed. Every claim carries its ground-truth source.

## Verified repo facts (2026-07-22)

| Fact | Source (tool-verified) |
|---|---|
| PR #17 (static security foundation) MERGED 2026-07-14 | `gh pr view 17` → `MERGED`, merge commit `d9b231d` (in `main` history) |
| PR #22 (reframe ADR-005/006/007) MERGED 2026-07-14 | `gh pr view 22` → `MERGED` |
| Branch protection #18 CLOSED **completed** 2026-07-13 | `gh issue view 18` → `state=CLOSED, stateReason=COMPLETED` |
| Independent final-head review #20 CLOSED **completed** 2026-07-16 | `gh issue view 20` → `COMPLETED` |
| ADR-003 / #13 CLOSED **not-planned** (superseded by ADR-005) | `gh issue view 13` → `NOT_PLANNED`; ADR-003 header `SUPERSEDED by ADR-005` |
| #14 product discovery (P0) **OPEN** | `gh issue view 14` → `OPEN` |
| #7 ADR-004 framework/build spike **OPEN** | `gh issue view 7` → `OPEN` |
| #23 T3 runtime spike (CEF vs Electron vs Chromium, P0) **OPEN** | `gh issue view 23` → `OPEN` |
| ADR-006 runtime protocol **PROPOSED** | `docs/adr/ADR-006-runtime-evaluation-protocol.md` header |
| First measured Electron/Windows row exists: 12/12, egress 0 | `spike/runtime-eval/harness/electron/` + `RESULTS_WINDOWS_2026-07-22.md` (harness exit 0) |
| **No signed contract exists** — zero tags, no `contract-v*` | `git tag -l` → empty (0 tags) |
| Signature verification impl BLOCKED on `nigin-engine` publication | `docs/adr/ADR-002` header: "Implementation: BLOCKED on `nigin-engine` contract publication" |

Correction vs the earlier framing "governance #18/#20 is the current bottleneck":
**both governance gates are already closed as completed.** Governance is done; the
open gates are now product and runtime.

## Layer 1 — `browser` (runtime): near-term progress is repo-internal

`browser`'s nearest progress does **not** depend on the signed `nigin-engine`
(ENG-01) contract, and does not need it yet. The near-term chain is entirely
in-repo:

```text
[DONE] governance: branch protection #18 + final-head review #20 (both closed completed)
   -> [P0 OPEN] product discovery #14 — one persona, one bounded read-only task,
                falsifiable go/pivot/stop  (no signed contract required)
   -> [OPEN]    runtime decision: ADR-006 measured matrix + #23 / #7
                (Electron/Windows row DONE; CEF fallback + macOS/Linux rows MISSING)
                (no signed contract required to run the spike)
```

Neither #14 nor the ADR-006 spike consumes the ENG-01 contract: the spike loads a
local, network-forbidden payload (`spike/runtime-eval/payload/`) under the runtime's
own security gate. So the contract's non-existence does **not** block Layer-1
near-term work.

## Layer 2 — `nigin-engine` (contract core): the signed contract does not exist

- There is **no signed, versioned ENG-01 contract**: `git tag -l` is empty, no
  `contract-v*` release, and ADR-002 verification implementation is explicitly
  BLOCKED on `nigin-engine` publishing that release.
- The signature/provenance chain (Sigstore keyless + SLSA, ADR-002) is **deferred
  while `nigin-engine` is a private repo** — keyless transparency-log signing would
  leak a private repo's identity into a public log (a known constraint), so the
  signed-release step waits until that repo's publication/visibility posture is set.
  *(Cross-repo visibility/timing of `nigin-engine` could not be verified from this
  repo — it is a separate repository, not checked out here.)*

## Layer 3 — `browser-nigin` (AI layer): primary blockee of the missing contract

The absent signed contract **primarily blocks `browser-nigin`** (the AI layer),
which is the layer that actually consumes ENG-01 semantics for its behaviour.
`browser` only needs the contract at the later "signed and pinned ENG-01 contract"
step of its decision order — well after the product (#14) and runtime (ADR-006)
gates — not now.

## Open decision — the two-contract ambiguity (must be resolved, not assumed)

There are **two different "contract" notions** in the repo and it is **not
specified** which one the reframed T1 runtime consumes:

1. **MCP-M1 contract** — `contracts/MCP_CONSUMER_PROFILE.md` ("APP-01 MCP Consumer
   Profile — M1"): pinned MCP protocol version + transport, MCP schemas/types,
   capability-negotiation and read-only fixtures. This is the **pre-reframe**
   MCP-client contract; ADR-002's example artifact is `mcp-contract.tar.gz`.
2. **WIT / signed-package contract** — the offline-runtime direction (ADR-007 signed
   package; the Wasmtime-host / WIT / component-model engine track referenced in
   `docs/007_ANALYSE_platform-track_PROVENIENZ.md`, `docs/ROADMAP.md`,
   `docs/CHARTER.md`).

The 2026-07-14 reframe (ADR-005/006/007) says `browser` "consumes a signed and
versioned contract from `nigin-engine`" and ADR-002 was *realigned* to read "MCP
contract" as "the signed `nigin-engine` contract artifact" — but the **shape** (MCP
tool-schema vs WIT/component-model package) was never reconciled. Consuming the wrong
shape would mis-scope ADR-002's verifier, the consumer profile, and the ENG-01
producer requirements. **This is an OPEN decision for Marco, not an assumption to
bake into code.**

## Gate table

| Gate | Layer | State (tool-verified) | Needs signed contract? | Blocks |
|---|---|---|---|---|
| Branch protection (#18) | browser | DONE (completed 2026-07-13) | no | — |
| Final-head review (#20) | browser | DONE (completed 2026-07-16) | no | — |
| Product discovery (#14, P0) | browser | OPEN | no | program validity (go/pivot/stop) |
| Runtime decision — ADR-006 matrix / #23 / #7 | browser | OPEN (1 of N rows measured) | no | runtime selection |
| Two-contract shape (MCP-M1 vs WIT/package) | cross-layer | OPEN / unspecified | n/a | ENG-01 producer scope + ADR-002 verifier shape |
| Signed ENG-01 contract release | nigin-engine | DOES NOT EXIST (0 tags) | — | browser-nigin (primary); browser (late gate) |
| Signature/provenance verifier impl (ADR-002) | browser | BLOCKED on ENG-01 release | yes | contract-consumption step |
| AI layer integration | browser-nigin | BLOCKED on signed contract | yes | AI layer |

## The one next blocker

**On the `browser` runtime track: complete the ADR-006 measured matrix** — the
Electron/Windows row is done (12/12, egress 0); the **CEF fallback harness and the
macOS/Linux rows are missing**, and ADR-006 cannot flip PROPOSED→ACCEPTED (a real
two-way, three-OS comparison) without them. This is a platform-build task needing the
three OSes, and it needs **no** ENG-01 contract.

Co-equal and strictly parallel: **#14 product-discovery (P0)** gates whether the
program should proceed at all; a chosen runtime with no validated task is premature.
Recommended framing for Marco: run #14 and the ADR-006 matrix completion in parallel;
do **not** start ADR-002 verifier implementation or any `browser-nigin` integration
until the signed ENG-01 contract exists **and** the two-contract shape is decided.

---
*Codie · program planning note · repo facts tool-verified 2026-07-22 · selections remain Marco's · not self-certified (Equalita/Data open).*
