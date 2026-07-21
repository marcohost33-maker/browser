# Issue #14 (D2) — Persona / Task / Consent Pre-Registration — PROPOSAL

- Status: **PROPOSAL for Owner go/pivot/stop** (Vero, 2026-07-21). Not a decision.
- Owner decision required: Marco (D2 is OPEN / P0).
- Method basis: `docs/research/PRODUCT_DISCOVERY_PROTOCOL.md` (READY FOR EXECUTION).
- Binding product frame: ADR-005 (T1→T2→T3, T3 north star), ADR-008 (standalone; MCP is an
  internal, optional capability **off** the T1 critical path).
- Purpose of this file: fill the protocol's **bracketed pre-registration fields** by
  **re-basing** them from the superseded "remote MCP endpoint / operator" framing onto the
  reframed **runtime product** (which app package is installed, its trust class, its local
  data domain, its network egress). The protocol requires these be committed **before** the
  first evaluative session.

> **Why this exists.** `PRODUCT_DISCOVERY_PROTOCOL.md` is method-complete but its candidate
> personas, tasks and consent questions are still phrased around a public MCP client /
> remote operator. The 2026-07-14 reframe note explicitly says those "are superseded and
> must be re-based on the runtime product … before the protocol is executed." This proposal
> does that re-basing so D2 can move. **Vero does not decide go/pivot/stop; this is the
> pre-registration Marco must accept, amend or reject.**

---

## 1. Re-based consent model (the core reframe)

Old frame (superseded): user must identify the **remote endpoint/operator**, the data **sent
over the network**, the requested capability and the revocation boundary.

New frame (T1 runtime product): there is normally **no network egress** and **no remote
operator**. The trust anchors the user must comprehend are instead:

| Old consent anchor | Re-based T1 anchor |
|---|---|
| Which endpoint/operator receives the data | **Which app package is installed, and who published/signed it (provenance)** |
| Which data is sent over the network | **Which local data domain the app can read, and that network egress is none (T1)** |
| Which capability is approved, for how long | **Which host capability the package is granted (storage/none), and its revocation** |
| How to cancel / clear the session | **How to remove the app package and clear its local data domain** |

This mapping is the substance of D2's "consent-comprehension" requirement under the reframe.

## 2. Recommended primary persona (choose one — proposed)

**Primary persona — "Owner-operator of a local offline tool."** A technically capable
individual (e.g. Marco / a Coworkerz user) who installs an **owner-controlled, signed,
offline webapp package** (T1) to perform one bounded local task, and who needs to **verify
that the app is the expected package, touches only its declared local data, and makes no
network calls** — replacing a cloud-hosted equivalent they no longer trust or want online.

Rationale: T1 = "owner-controlled offline webapps" (ADR-005). The first real user IS the
owner running a first-party package; this persona is reachable now, needs no arbitrary-content
isolation (that is T3), and directly tests the reframed consent model.

**Anti-personas for M1 (unchanged intent, re-based):**
- users who need to run **arbitrary unknown/foreign** webapps (that is the T3 target, not M1);
- users who need **write/autonomous** capability or tool-chains (out of M1 read-only scope);
- users who cannot verify **package provenance** where high-risk local data is involved;
- enterprise tenants needing controls not present in the M1 architecture.

## 3. Recommended single bounded read-only task (proposed)

**Task:** "Install the provided signed offline webapp package, open it, use it to **read and
display one bounded local dataset** (a fixed fixture, e.g. a local JSON/CSV the package ships
or reads from its declared data domain), obtain the correct result, and then answer what the
app could access and how to remove it — all with the machine **offline**."

Properties: read-only (no writes, no autonomy), fully offline (proves T1 no-egress),
bounded result, and it exercises install → provenance display → data-domain display →
result → removal/clear. Non-goals: no arbitrary URLs, no remote fetch, no credentials.

## 4. Pre-registered hypothesis (bracket fields filled — proposed)

> For an **owner-operator of a local offline tool** who needs to **install and use a signed
> offline webapp package to read one bounded local dataset while fully offline**, `browser`
> (T1) enables a correct result in **≤ 3 minutes** with at least a **4 of 5** participant
> success rate (no facilitator rescue), while at least **80% (4 of 5)** correctly identify
> **(a) which package/publisher is installed, (b) which local data domain it can read, (c)
> that it made no network calls, and (d) how to remove it and clear its data**. Existing
> alternatives fail because **the equivalent tool is cloud-hosted — the user cannot prove
> offline-only operation or a bounded local data domain, and must trust a remote operator.**

*(Thresholds ≤3 min / 4-of-5 / 80% are drawn directly from the protocol's own falsification
examples. They are **proposed for commitment**; Marco fixes the exact numbers before session 1.)*

## 5. Re-based falsification criteria (pivot/stop triggers)

The hypothesis is **rejected or pivoted** if any pre-registered condition is met:
- fewer than 4 of 5 participants complete the task without facilitator rescue;
- median completion time does not materially beat the current cloud tool;
- fewer than 80% correctly answer all four re-based comprehension questions (§1);
- participants **cannot tell which package/publisher** they installed, or **wrongly believe
  the app sent data over the network** when it did not (or vice-versa);
- the task in practice requires write/autonomous capability outside M1;
- interviews show no recurring problem or no willingness to adopt an offline-first tool;
- an existing offline tool solves it with lower risk and comparable usability.

## 6. Re-based comprehension check (asked without re-showing consent text)

1. Which app package / publisher did you install and open?
2. Which local data could this app read? Did it (or could it) send anything over the network?
3. Which host capability did you grant, and does it persist?
4. How do you remove this app and clear its local data?

## 7. What Marco must confirm (the actual D2 gate)

1. **Persona**: accept "owner-operator of a local offline tool" as the single primary persona,
   or substitute.
2. **Task**: accept the bounded offline read-one-dataset task, or substitute.
3. **Thresholds**: fix exact numbers (time / success / comprehension %) — proposal in §4.
4. **go / pivot / stop** for executing Phases 1–3 (5–8 sessions). Valid outcomes include a
   controlled internal tool, integration into an existing host, or **stop** — momentum is not
   value (protocol §Purpose).

## 8. Evidence handling reminders (from protocol)

- Participant codes, no unnecessary names; never collect real credentials/tokens/production data.
- Raw observations, interpretation and decisions kept separate.
- Consent + notes in the **private** evidence location, **not** in this public repo; publish
  only aggregated/redacted findings.
- Record protocol version + prototype commit + session date.

## 9. Gate to close #14

`#14` closes only when a dated **decision record** (protocol §Decision record) links sufficient
evidence and the chosen task is compatible with an endpoint/deployment/runtime architecture
that passes APP-01's security, privacy, accessibility and operational gates. This proposal is
the **pre-registration**, not that decision record.

---
*Coworker Research / Coworkerz · re-bases `PRODUCT_DISCOVERY_PROTOCOL.md` onto the ADR-005 runtime product · feeds D2 / issue #14.*
