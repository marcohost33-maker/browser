# ADR-005 — Offline Runtime Trust Classes

- Status: ACCEPTED
- Date: 2026-07-14
- Decision owner: Marco
- Decision: Marco G1 (2026-07-14) — staged trust-class maturation T1 → T2 → T3,
  with T3 as the target state (north star)
- Cross-family review: ChatGPT complete; Gemini V2 reviewed; Vero adjudication open
- Supersedes the trust-scope product assumptions in ADR-001

## Context

`browser` is being reframed from a public MCP web application into a native,
offline-capable host for web applications, whose committed end state is running
arbitrary foreign webapps. The runtime choice cannot be made before the trust
class staging is explicit. A system that runs first-party packages is not
equivalent to a general browser that navigates arbitrary remote sites; the
programme therefore matures through explicit trust classes rather than claiming
the strongest class up front.

Tauri capabilities reduce frontend-to-core privilege exposure, but they do not
make arbitrary content trusted. Tauri's core process remains fully privileged;
capability safety depends on exact window/webview binding, command registration,
scopes and command implementation. Platform WebView vulnerabilities, permissive
configuration and malicious Rust code remain outside that protection.

## Trust classes

The three classes are the staged maturation path, not mutually exclusive
scopes. Each stage is a prerequisite for the next.

### T1 — Owner-controlled package (first shipping increment)

- source and release pipeline controlled by the project;
- package signed by an approved publisher key;
- deterministic manifest and complete payload digest set;
- reviewed capability and network policy;
- the first shipping increment on the path to T3.

### T2 — Curated third-party package (gated follow-up)

- publisher identity and key verified;
- package reviewed or admitted through a documented policy;
- no direct native API exposure;
- capability grants require explicit user/admin approval;
- unlocked only after T1 isolation and update evidence passes.

### T3 — Arbitrary foreign web content (target state / north star)

- unknown publisher and code provenance;
- may navigate, embed, download or load dynamic third-party code;
- requires browser-grade permission UI, navigation policy, certificate handling,
  profile separation, download safety, patch SLA and compatibility testing;
- requires a runtime with inherited, process-level site isolation and an
  auditable engine security-patch path (see technical consequence below);
- the intended end state of the programme, unlocked only after the T1 and T2
  maturity gates pass; not delivered in the first shipping increment.

## Decision (Marco G1, 2026-07-14)

The programme adopts a staged trust-class maturation with T3 as its target state
(north star). The three classes are accepted as the roadmap and delivered in
sequence:

1. T1 (owner-controlled signed packages) is the first shipping increment.
2. T2 (curated third-party packages) is a gated follow-up, unlocked only after
   the package verifier, per-app data isolation, capability broker and rollback
   pipeline are independently reviewed.
3. T3 (arbitrary foreign web content) is the target state, unlocked only after
   T2 plus browser-grade navigation, permission UI, certificate handling,
   download safety, a maintained engine security-patch path and compatibility
   testing are in place. T3 must not be described as safe merely because IPC
   permissions are empty.
4. No runtime framework is accepted by this ADR. ADR-006 defines the measured
   comparison; the binding framework decision stays there.

## Technical consequence of the T3 target

Cross-family review (Vero, ChatGPT, Aegis) constrains the runtime shortlist now,
even though the binding choice stays in ADR-006, because T3 is a committed end
state rather than a hypothetical:

- Real site isolation for unknown foreign code needs process-level site
  isolation inherited from the engine. Chromium's default boundary is a *site*
  (scheme + eTLD+1), not a full origin; per-*origin* process locking requires
  Origin-Agent-Cluster and must be demonstrated, not inferred from the engine
  default (see ADR-006). A Chromium-based runtime (Electron or CEF) inherits
  Chromium's site isolation; a system-WebView wrapper such as Tauri does not
  provide equivalent cross-origin process isolation for hostile content. The T3
  runtime direction is therefore Chromium/CEF/Electron.
- A shippable engine security-patch path is a hard cut criterion (evaluated in
  ADR-006): a bundled Chromium can be patched by the project on its own release
  cadence, whereas a system WebView ties patch latency to the host OS vendor.
- For foreign-publisher identity, the `.swbn`/IWA track (ADR-007 Track A) gains
  weight over the T1-oriented minimal-manifest lean (ADR-007 Track B): a signed
  web bundle carries a verifiable publisher origin suited to third-party
  provenance. Both tracks remain in the ADR-007 spike.

This constrains candidates without deciding them. Tauri remains a valid
candidate for the owner-controlled AI shell (APP-02), not for APP-01 T3.

## Required invariants

- No generic native bridge in app webviews.
- Registered custom commands are explicitly allowlisted and sender-bound.
- Each app receives a stable cryptographic identity and separate data domain.
- Network, navigation, popup, download and external-protocol access are denied by
  default.
- A package signature establishes provenance and integrity, not code safety.
- CSP is defence in depth and does not certify absence of XSS or malicious logic.
- An app cannot widen its own capabilities, network policy or storage scope.

## Rejected statement

> "Tauri v2 is validated for arbitrary foreign apps if IPC is default-deny."

Reason: default-deny IPC limits one privilege-escalation path. It does not provide
the complete browser security product required for unknown code, nor does it
eliminate WebView, navigation, storage, parser, download or renderer attack
surfaces.

## Per-increment evidence gates

The staged trust-class decision is accepted; each increment (T1, then T2, then
T3) must still clear the evidence below before it ships:

- [ ] threat model for T1/T2/T3
- [ ] exact capability inventory and zero-capability app test
- [ ] proof that registered custom commands are not globally exposed
- [ ] per-app storage/profile isolation tests on Windows, macOS and Linux
- [ ] negative navigation/popup/download/external-protocol tests
- [ ] independent review of the accepted trust boundary
