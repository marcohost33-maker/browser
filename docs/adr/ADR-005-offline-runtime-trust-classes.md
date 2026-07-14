# ADR-005 — Offline Runtime Trust Classes

- Status: PROPOSED
- Date: 2026-07-14
- Decision owner: Marco
- Cross-family review: ChatGPT complete; Gemini V2 reviewed; Vero adjudication open
- Supersedes product assumptions in ADR-001 only after acceptance

## Context

`browser` is being reframed from a public MCP web application into a native,
offline-capable host for locally installed web applications. The runtime choice
cannot be made before the trust class is explicit. A system that runs first-party
packages is not equivalent to a general browser that navigates arbitrary remote
sites.

Tauri capabilities reduce frontend-to-core privilege exposure, but they do not
make arbitrary content trusted. Tauri's core process remains fully privileged;
capability safety depends on exact window/webview binding, command registration,
scopes and command implementation. Platform WebView vulnerabilities, permissive
configuration and malicious Rust code remain outside that protection.

## Trust classes

### T1 — Owner-controlled package

- source and release pipeline controlled by the project;
- package signed by an approved publisher key;
- deterministic manifest and complete payload digest set;
- reviewed capability and network policy;
- eligible for v1.

### T2 — Curated third-party package

- publisher identity and key verified;
- package reviewed or admitted through a documented policy;
- no direct native API exposure;
- capability grants require explicit user/admin approval;
- eligible only after T1 isolation and update evidence passes.

### T3 — Arbitrary foreign web content

- unknown publisher and code provenance;
- may navigate, embed, download or load dynamic third-party code;
- requires browser-grade permission UI, navigation policy, certificate handling,
  profile separation, download safety, patch SLA and compatibility testing;
- explicitly out of v1 scope.

## Proposed decision

1. v1 supports T1 only.
2. T2 is a gated follow-up after the package verifier, per-app data isolation,
   capability broker and rollback pipeline are independently reviewed.
3. T3 is a separate product programme. It must not be described as safe merely
   because IPC permissions are empty.
4. No runtime framework is accepted by this ADR. ADR-006 defines the measured
   comparison.

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

## Acceptance evidence

- [ ] threat model for T1/T2/T3
- [ ] exact capability inventory and zero-capability app test
- [ ] proof that registered custom commands are not globally exposed
- [ ] per-app storage/profile isolation tests on Windows, macOS and Linux
- [ ] negative navigation/popup/download/external-protocol tests
- [ ] independent review of the accepted trust boundary
