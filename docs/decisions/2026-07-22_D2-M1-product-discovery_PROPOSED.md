# D2 / #14 — M1 Product Discovery: primary user, bounded read-only task, go/pivot/stop

- Status: **PROPOSED** (recommendation with rationale; the go/pivot/stop call is Marco's)
- Date: 2026-07-22
- Owner issue: #14 (P0, critical-path)
- Author: Vero (Claude Opus 4.8). **Not self-certified** — Equalita/Data + Marco decision open.
- Binding context: ADR-005 (ACCEPTED, T1→T2→T3, north star T3), reframe 2026-07-14.
- Supersedes nothing; fills the P0 evidence gap named in `docs/OPEN_DECISIONS.md` D2.

> **Why this exists.** `docs/OPEN_DECISIONS.md` D2 and the critical-path note both name
> the same P0 blocker: no feature work is legitimate until `browser` has one named
> primary user, one bounded read-only task, measurable success/consent thresholds, and
> a falsifiable go/pivot/stop frame. `PROGRAM_CRITICAL_PATH.md` confirms governance is
> closed and this is now the nearest open gate that needs **no** signed ENG-01 contract.
> This record proposes that frame so Marco can accept, pivot, or stop.

## 1. The trap this avoids

`browser`'s committed end state (T3: run arbitrary hostile foreign web apps locally) is
a research north star, not an M1 product. Building M1 *as if* it were already T3 would
(a) claim a security class we cannot yet prove (ADR-005/006 keep T3 fail-closed), and
(b) skip the falsifiable question: **does anyone get value from running a curated web
app fully locally with a verifiable no-network guarantee?** If that value is not real,
the whole programme should pivot before T3 runtime spend. M1 must test that, cheaply.

## 2. Proposed primary persona (one) and anti-persona

**Primary persona — "the offline-first Coworkerz app owner" (start: Marco himself).**
A person who already owns small web apps currently served from the cloud (Cloudflare
Pages: portfolio, HexForge viewer, scanners, 3D tools) and wants to run *one specific,
trusted* app **fully locally and offline**, with a guarantee — that they can see and
believe — that the app made **zero network calls**. Motivation: independence from cloud
hosting/cost, privacy, and offline availability. This persona is real and present today
(it is the LOCAL-FIRST direction Marco already committed to), so M1 value is testable
without inventing a market.

**Anti-persona — "the arbitrary-URL web surfer."** Someone who wants to type any remote
URL and browse the live web. That is a general browser navigating hostile remote origins
— the T3 north star — and is explicitly **out of scope for M1**. Serving that persona in
M1 would force the strongest (unproven) trust class up front. M1 does not navigate to
remote origins; it runs a **curated, locally-held** app.

## 3. Proposed bounded read-only task (one)

> **Task M1-T:** Open one curated, locally-held web app (e.g. a HexForge viewer or the
> portfolio) in the `browser` runtime, **fully offline**, perform its core *read-only*
> interaction (view/scroll/zoom — no writes to any external system), and be shown a
> truthful, verifiable "offline · no network egress" indicator for that session.

Properties that keep it bounded and honest:
- **Read-only:** no form submission, no external write, no credential entry. Any state is
  local and ephemeral. This keeps M1 inside T1/T2 (curated/signed), not T3.
- **Network-forbidden by construction:** the app is loaded from a local, immutable,
  network-denied payload under the runtime's own egress gate — exactly the mechanism the
  Electron/Windows spike already exercises (`spike/runtime-eval/payload/`, egress
  deny-all + WebRTC `disable_non_proxied_udp`).
- **Falsifiable value:** if the persona does not actually want offline-local running of
  their own apps (prefers the cloud), M1 fails its value test → pivot.

## 4. Measurable thresholds (M1 acceptance)

| Dimension | Metric | Pass threshold (proposed) | How measured (no new infra) |
|---|---|---|---|
| Task success | App renders + core read interaction works offline | 1 curated app, 100% of core read steps complete offline, 0 crashes over N=20 launches | runtime harness launch + scripted read steps; harness exit 0 |
| Egress guarantee | Observed network egress during the session | **0** (TCP/UDP/DNS/WebRTC) | existing egress gate + independent observation layer (see ChatGPT F2 in cross-family record) |
| Consent comprehension | User can correctly state, after the session, whether the app reached the network | ≥ 90% correct on a 1-question check | 1-question post-session prompt |
| Honesty of the indicator | The "no network" indicator is never shown while egress > 0 | 100% (fail-closed: indicator suppressed on any deviation) | assertion tie of indicator state to the egress-gate result |

The honesty row is the important one: the indicator must be **bound to the measured
egress result**, never a static label. A green "offline" badge shown while any egress
occurred is a stop-the-line defect (same class as the CWAP/security-by-declaration NR).

## 5. Go / pivot / stop frame (falsifiable)

- **GO** (proceed to harden M1 → T2 curated/signed apps) **iff**: all four thresholds in
  §4 pass for ≥ 1 curated app, *and* the persona confirms they would use offline-local
  running over the cloud for at least that app.
- **PIVOT** (re-scope) **iff**: the egress/honesty guarantees hold but the persona does
  **not** value offline-local running (task success high, desire low) → the runtime is
  sound but the product frame is wrong; re-target (e.g. a different bounded task, or a
  developer/audit persona) before any T3 spend.
- **STOP** (halt the public-runtime line) **iff**: the egress or honesty guarantee cannot
  be met for even one curated app under the runtime's own gate → the core promise
  ("verifiable no-network local run") is unachievable, so T3 is out of reach and the
  programme should not spend on runtime selection.

## 6. What this record does NOT decide

- It does **not** select a runtime (that is ADR-006 + #23, and needs macOS/Linux/CEF rows
  the Windows box cannot produce).
- It does **not** select a package format (ADR-007 + #24).
- It does **not** promote any trust class to T3.
- It does **not** claim M1 is built. It defines the falsifiable target so effort is not
  spent against an unproven T3 assumption.

## 7. Recommendation to Marco (one line)

Accept this persona + bounded read-only task + thresholds as the M1 discovery frame, so
the Electron/Windows spike (already at 12/12, egress 0) can be pointed at **one real
curated Coworkerz app** as the first falsifiable value test — before any cross-platform
runtime spend.

---
*Provenance: verified against `docs/OPEN_DECISIONS.md` D2, `docs/PROGRAM_CRITICAL_PATH.md`,
`docs/adr/ADR-005-offline-runtime-trust-classes.md` (ACCEPTED), and the Electron/Windows
spike result (`spike/runtime-eval/harness/electron/RESULTS_WINDOWS_2026-07-22.md`: 12/12,
egress 0). PROPOSED — awaits Marco go/pivot/stop and Equalita/Data review.*
