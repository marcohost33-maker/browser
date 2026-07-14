# Browser Reframe Decision Checklist

- Status: ACTIVE GATE
- Date: 2026-07-14
- Scope: architecture evidence only; no production claim

## A. Product identity

- [ ] `browser` is defined as a native offline runtime, not a public MCP webapp.
- [ ] `nigin-engine` remains the engine/contract core.
- [ ] `browser-nigin` remains an optional later AI layer.
- [x] Trust-class staging is decided — Marco G1 (2026-07-14): DECIDED T3
      (staged) — T1 → T2 → T3 with T3 (arbitrary foreign content) as the target
      state; ADR-005 ACCEPTED.
- [x] Arbitrary foreign content is the accepted target state (T3), reached via
      the staged T1 → T2 → T3 maturation, not excluded and not a separate
      product.

## B. Reuse from PR #17

- [ ] CI pinning, least privilege, SBOM and evidence generation reviewed for
      product neutrality.
- [ ] Security-policy tests reused only where their assumptions still apply.
- [ ] README, charter, ADR-001, ADR-003 and old product-discovery claims marked
      superseded or rewritten before merge.
- [ ] Branch protection and independent final-head review remain enforced.
- [ ] No green CI result is described as product validation.

## C. Runtime spike

- [ ] Tauri/WRY measured on Windows, macOS and Linux.
- [ ] Electron measured with sandbox, context isolation and zero broad preload.
- [ ] WebView2-direct reference measured on Windows where useful.
- [ ] Same signed fixture and negative corpus used for every candidate.
- [ ] Cold/warm start, memory, CPU, package size and compatibility recorded.
- [ ] Per-app profile/storage separation demonstrated.
- [ ] Crash and hang recovery demonstrated.
- [ ] Engine security-update responsibility and patch SLA documented.
- [ ] No framework accepted solely because it is smaller or uses Rust.

## D. Native trust boundary

- [ ] App webviews receive no generic native API.
- [ ] Every custom command is registered, capability-bound, sender-validated and
      argument-validated.
- [ ] Capability files do not overlap unintentionally.
- [ ] Navigation, popup, download and external protocols are default-deny.
- [ ] Network access is default-deny with exact app-specific grants.
- [ ] Filesystem and process execution are absent from v1 app contexts.
- [ ] Broker logs are privacy-minimised and tamper-evident where required.
- [ ] IPC isolation is treated as defence in depth, not as a general hostile-code
      sandbox proof.

## E. Package and install pipeline

- [ ] `.swbn` verifier spike completed.
- [ ] minimal manifest-root comparison spike completed.
- [ ] signature, package identity and publisher trust are separated conceptually.
- [ ] malformed parser corpus and fuzzing completed.
- [ ] path, Unicode, case, size and compression limits tested.
- [ ] atomic install, failed-install cleanup and rollback tested.
- [ ] downgrade, revocation and key-rotation policy tested.
- [ ] permission expansion requires explicit approval.
- [ ] wording says `.swbn` is signed, not encrypted.
- [ ] custom `app://` does not inherit unimplemented IWA guarantees in claims.

## F. Web security

- [ ] CSP and Trusted Types negative fixtures pass.
- [ ] XSS resistance is not inferred from package signing alone.
- [ ] Wasm source, compilation and capability policy are explicit.
- [ ] Service workers and caches are per-app and removable.
- [ ] shared browser data between apps is rejected by tests.
- [ ] secure-context behaviour of custom schemes is verified per platform.

## G. Updates and offline behaviour

- [ ] manual offline sideload works with no network access.
- [ ] optional update checks are separately consented and disableable.
- [ ] update metadata is authenticated and replay-resistant.
- [ ] downloaded update is fully verified before activation.
- [ ] update failures preserve the previously working version.
- [ ] no hidden telemetry or mandatory ping-back is present.

## H. Legal and compliance

- [ ] GDPR roles, data flows, purposes, retention and user rights are mapped from
      actual processing, not from generic AI labels.
- [ ] AI Act classification is performed per intended purpose and deployment use
      case; infrastructure status alone is not labelled high-risk.
- [ ] Article 19 log obligations are claimed only if the system is a relevant
      high-risk AI system.
- [ ] Article 86 is not described as a general explanation duty for every agent
      output.
- [ ] current application dates and amendments are rechecked before release.
- [ ] legal conclusions receive qualified legal review where material.

## I. Cross-family and release governance

- [ ] ChatGPT position recorded.
- [ ] Gemini position recorded.
- [ ] disagreements listed claim-by-claim.
- [ ] Vero adjudication references primary evidence.
- [ ] accountable human owner accepts the architecture decision.
- [ ] final-head independent review completed after the last commit.
- [ ] merge, release and production statuses remain separate.

## Current blockers

1. Runtime comparison has not been executed.
2. Neither package verifier track has been implemented.
3. T2 curated third-party admission policy is undefined.
4. PR #17 still carries the old product premise.
5. The trust-class staging owner decision is made (Marco G1, 2026-07-14: T3
   staged). Vero cross-family adjudication and the remaining owner decisions
   (runtime in ADR-006, package format in ADR-007) remain open.
