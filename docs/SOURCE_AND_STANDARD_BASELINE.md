# Source and Standards Baseline

- Status: WORKING
- Date: 2026-07-10

## Purpose

Prevent roadmap, architecture and security claims from relying on secondary summaries, stale versions or unreviewed research. This file defines the source hierarchy and the minimum primary-source set for APP-01.

## Source hierarchy

1. Normative specifications and RFCs
2. Official implementation/security guidance from the specification owner
3. Accepted project ADRs and pinned ENG-01 contract artifacts
4. Reproducible test evidence and release artifacts
5. Official standards implementation guidance
6. Peer-reviewed or preprint research, treated as advisory until reproduced or mapped to a concrete control
7. Blogs, media, encyclopedias and vendor commentary, used only for discovery, never as sole evidence for a production requirement

## Required primary-source families

### MCP

- Official MCP specification revision selected by ENG-01
- Official MCP security best practices
- Official authorization specification when OAuth is enabled
- Official transport and lifecycle requirements
- Official tool/resource/prompt semantics used by the selected slice

Rules:

- Record exact protocol revision and retrieval date.
- Do not copy future or experimental requirements into the production profile without an ADR.
- Capability metadata and annotations remain untrusted input even when protocol-valid.
- Reject unsupported security-critical semantics; do not reject harmless extension fields merely because they are unknown.

### Web platform security

- CSP specification and MDN/W3C-compatible implementation guidance
- Fetch, CORS and browser storage behavior relevant to the chosen topology
- OAuth 2.0 Security Best Current Practice and PKCE requirements when authorization is enabled
- OWASP ASVS/client-side guidance as a control checklist, not a replacement for protocol-specific analysis

Rules:

- A static SPA cannot assume arbitrary remote MCP endpoints are reachable: CORS, credentials, redirects and CSP are architectural constraints.
- `connect-src` policy must follow the endpoint model; it cannot be finalized before that decision.
- Memory-only tokens reduce persistence risk but do not mitigate XSS or malicious dependencies.

### Accessibility

- W3C WCAG 2.2 Recommendation
- WAI-ARIA Authoring Practices only where native HTML cannot provide the needed semantics

Rules:

- Automated scanners are partial evidence.
- Manual keyboard, focus, zoom/reflow and assistive-technology tests are required for the critical flow.
- Do not claim WCAG conformance without a complete scoped conformance evaluation.

### Secure development and supply chain

- NIST SP 800-218 SSDF
- SLSA provenance requirements
- SPDX or CycloneDX specifications for SBOM format
- GitHub official security-hardening guidance for Actions used by the repository

Rules:

- SBOM existence is not equivalent to completeness or release integrity.
- Provenance, pinned dependencies/actions, vulnerability response and reproducible verification are separate controls.
- CI evidence must identify tool versions, environment and artifact digest.

## Research use

Research papers may identify new threats or candidate controls. Before a paper-derived control becomes mandatory:

1. State the paper's claim and limitations.
2. Verify whether the threat applies to APP-01's selected architecture.
3. Reproduce a minimal attack or test vector when feasible.
4. Map the result to a requirement, control and acceptance test.
5. Mark unresolved findings as research risk, not established fact.

## Citation and freshness policy

Every normative requirement in an ADR or security profile must include:

- source title;
- exact version/revision;
- publication or revision date;
- retrieval date;
- affected requirement IDs;
- supersession review trigger.

Review triggers:

- MCP revision change;
- ENG-01 contract release;
- OAuth or endpoint-model change;
- browser-support change;
- major dependency/toolchain upgrade;
- public-release preparation.

## Corrections to prior analysis

- Secondary Wikipedia summaries are removed as authoritative support for WCAG or CSP.
- Unreproduced MCP security papers remain useful threat-discovery inputs, not normative protocol facts.
- "Fail closed on unknown fields" is narrowed to unknown mandatory or security-relevant semantics; forward-compatible extensions require deliberate schema policy.
- "Memory-only credentials" is classified as one control, not a complete browser authorization design.
- "Production-ready" remains prohibited until implementation, verification, deployment and operational gates pass.
