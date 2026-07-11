# APP-01 M1 Product Discovery Protocol

- Status: READY FOR EXECUTION
- Date: 2026-07-11
- Owner issue: #14
- Decision supported: go, pivot or stop for the first public browser slice

## Purpose

APP-01 currently has stronger security and architecture foundations than product
evidence. This protocol prevents implementation momentum from being mistaken for
user value.

It does not assume that a public browser client is the correct product form.
A controlled internal client, a gateway-mediated application, integration into
an existing host or stopping the product are valid outcomes.

## Pre-registered hypothesis

Before recruiting participants, replace bracketed fields and commit the change:

> For **[primary persona]** who needs to **[specific read-only task]**, APP-01
> enables a correct result in **[target time]** with at least **[success rate]**,
> while at least **[consent comprehension threshold]** correctly identify the
> endpoint/operator, data sent, requested capability and revocation boundary.
> Existing alternatives fail because **[measurable unmet need]**.

## Falsification criteria

The M1 hypothesis is rejected or pivoted when any pre-registered condition is
met, for example:

- fewer than 4 of 5 representative participants can complete the task without
  facilitator rescue;
- median completion time does not improve materially over the current
  alternative;
- fewer than 80% correctly answer all four consent-comprehension questions;
- participants cannot distinguish APP-01 from the MCP endpoint/operator;
- the required endpoint class conflicts with ADR-003 security or deployment
  constraints;
- the task requires write/autonomous capabilities outside M1;
- interview evidence shows no recurring problem or willingness to adopt;
- an existing client solves the task with lower risk and comparable usability.

Exact thresholds must be committed before the first evaluative session.

## Candidate personas

Recruitment may explore multiple candidates, but the decision chooses one:

- technically capable user who needs a transparent read-only MCP inspection
  client without installing a desktop host;
- developer or operator validating a controlled MCP endpoint and capabilities;
- privacy-sensitive user executing one approved read-only task against a known
  service.

Anti-personas for M1 include:

- users requiring arbitrary unknown endpoints;
- users requiring write tools or autonomous chains;
- users unable to verify the endpoint/operator relationship where high-risk data
  is involved;
- enterprise tenants requiring controls not represented in the M1 architecture.

## Research questions

1. What job is the participant trying to complete today?
2. What is slow, opaque, risky or unavailable in the current method?
3. Which information must be visible before connecting or approving a request?
4. Which endpoint/operator does the participant believe receives the data?
5. Which data is considered sensitive and what failure is unacceptable?
6. Does a browser application reduce or increase trust and deployment friction?
7. Which error, revocation and recovery behavior is expected?
8. Why would the participant use APP-01 instead of an existing MCP client?

## Method

### Phase 1 — problem interviews

- 5–8 structured sessions across the leading persona candidates.
- Ask about recent observed behavior, not hypothetical feature preference.
- Record current workflow, frequency, consequences, alternatives and adoption
  constraints.
- Avoid presenting the planned architecture before the problem is understood.

### Phase 2 — task and consent prototype

Use a non-networked or mock-backed prototype representing:

1. endpoint/operator identity;
2. data-flow and privacy boundary;
3. capability list as untrusted data;
4. one read-only request with visible arguments;
5. explicit approval/rejection;
6. loading, timeout, cancel and normalized errors;
7. bounded result and clear-session behavior.

The prototype must not imply that a real MCP connection or production security
claim exists.

### Phase 3 — endpoint/deployment fit

For the selected task, map:

- controlled versus arbitrary endpoint need;
- direct browser CORS feasibility;
- authentication and credential requirements;
- data categories and operator responsibilities;
- offline/PWA need;
- support and incident expectations.

Feed these results into ADR-003.

## Session script

### Introduction

- State that the product is exploratory and the interface, not the participant,
  is being evaluated.
- Obtain permission for notes or recording.
- Do not collect real credentials or sensitive production data.

### Current behavior

- “Show or describe the last time you completed this task.”
- “What did you use, how long did it take and where did it fail?”
- “What information or data was involved?”

### Prototype task

Give the participant a realistic scenario and ask them to think aloud. Do not
explain labels unless they are blocked; record the point and type of assistance.

### Comprehension check

Without showing the consent text again, ask:

1. Which endpoint/operator receives the request data?
2. Which exact data or arguments are sent?
3. Which capability is being approved and for how long?
4. How can the action be cancelled or the session cleared?

### Closing

- “Would you replace your current method with this? Why or why not?”
- “What would prevent adoption?”
- “Which existing tool is closest?”

## Measures

### Quantitative

- task completion without assistance;
- time on task;
- number/type of errors;
- consent-comprehension score;
- correct endpoint/operator attribution;
- cancellation and clear-session discovery;
- adoption intent tied to a concrete future use, not a satisfaction rating.

### Qualitative

- recurring job and trigger;
- current workaround;
- trust and privacy concerns;
- observed terminology confusion;
- endpoint/deployment constraints;
- reasons for non-adoption;
- evidence favoring an existing product or different form.

## Evidence handling

- Assign participant codes; do not store unnecessary names.
- Never collect credentials, real tokens or production request contents.
- Separate raw observations, researcher interpretation and decisions.
- Record protocol version, prototype commit and session date.
- Store consent and research notes in the approved private evidence location,
  not in the public release repository.
- Publish only aggregated or redacted findings.

## Decision record

After research, add a dated decision containing:

- selected persona and anti-persona;
- selected task and non-goals;
- hypothesis thresholds and observed results;
- contradictory and negative evidence;
- comparison with existing alternatives;
- endpoint/deployment implications for ADR-003;
- go, pivot or stop decision;
- owner and next experiment.

## Gate

Issue #14 may close only when the decision record links sufficient evidence and
the chosen task is compatible with an endpoint/deployment architecture that can
pass APP-01's security, privacy, accessibility and operational gates.
