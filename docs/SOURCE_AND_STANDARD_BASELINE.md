# Source and Standards Baseline

- Status: ACTIVE WORKING BASELINE (product reframed 2026-07-14)
- Updated: 2026-07-14
- Repository: `marcohost33-maker/browser`
- Source verification date: 2026-07-11 UTC

> **Framing note (2026-07-14).** `browser` is reframed into a native, offline-capable
> browser/webapp runtime program (ADR-005/006/007, PR #22). The source-hierarchy and
> traceability discipline below is framing-neutral and retained. Constraints phrased
> around a "static SPA / public browser client consuming remote MCP endpoints"
> reflect the superseded architecture; the runtime product's architecture and its
> runtime-framework choice are governed by ADR-005/006 (no framework accepted yet).
> Read those lines as historical baseline, not current architecture.

## Purpose

Prevent roadmap, architecture and security claims from relying on secondary summaries, stale versions or unreviewed research. Normative requirements must be traceable to a versioned primary source or reproducible project evidence.

## Source hierarchy

1. Normative specifications and RFCs.
2. Official security and implementation guidance from the specification owner.
3. Accepted APP-01 ADRs and the pinned external contract artifact.
4. Reproducible tests, CI logs and release artifacts.
5. Official standards implementation guidance.
6. Peer-reviewed or preprint research, treated as advisory until reproduced or mapped to a concrete APP-01 control.
7. Blogs, media, encyclopedias and vendor commentary, used only for discovery and never as sole production evidence.

## Locked primary-source register

### Model Context Protocol

- Current published MCP protocol revision re-verified on 2026-07-11 UTC: `2025-11-25`.
- Versioning: `https://modelcontextprotocol.io/docs/learn/versioning`
- Specification: `https://modelcontextprotocol.io/specification/2025-11-25`
- Security best practices: `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
- Authorization: use the authorization section belonging to the protocol revision selected by the contract owner.

Project rules:

- The current upstream revision is a research reference, not an automatic runtime upgrade.
- APP-01 implements only the revision explicitly pinned by its accepted contract/compatibility ADR.
- Client and server must negotiate one compatible revision during initialization.
- User consent, data privacy and tool safety remain explicit host/client responsibilities.
- Tool descriptions, annotations, resource content and remote URLs are untrusted input even when protocol-valid.
- Token passthrough is forbidden; sessions are not authentication.
- Authorization and approved remote endpoint URLs require HTTPS in production.
- Plain HTTP is restricted to explicit `localhost`, `127.0.0.1` or `::1` development origins.
- Unknown mandatory or security-relevant semantics fail closed. Harmless extensions follow the documented compatibility policy.

### OAuth and browser authorization

- OAuth 2.0 Security Best Current Practice: RFC 9700, January 2025.
  - `https://www.rfc-editor.org/rfc/rfc9700`
- Proof Key for Code Exchange: RFC 7636.
  - `https://www.rfc-editor.org/rfc/rfc7636`

Project rules when OAuth is enabled:

- Authorization Code flow with PKCE for a public browser client.
- Exact redirect URI matching; no wildcards.
- State/issuer validation and protection against mix-up and code injection.
- Audience-restricted access tokens; no token passthrough.
- No access tokens in URLs, browser history, logs or persistent web storage.
- Memory-only storage reduces persistence exposure but does not protect against XSS or compromised dependencies.
- A backend-for-frontend is a separate architecture option, not an implicit assumption.

### Web platform security

Primary sources and implementation references:

- Permissions Policy Editor's Draft, retrieved 2026-07-11 UTC:
  - `https://w3c.github.io/webappsec-permissions-policy/`
- MDN Permissions-Policy reference:
  - `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy`
- OWASP HTTP Headers Cheat Sheet:
  - `https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html`
- GitHub Actions secure-use guidance:
  - `https://docs.github.com/en/actions/reference/security/secure-use`

Status rule:

- The Permissions Policy Editor's Draft is work in progress and is used for current grammar and processing behavior, not as a claim of stable W3C Recommendation status.

Project rules:

- A static SPA cannot assume arbitrary remote MCP endpoints are reachable; CORS, credentials, redirects and CSP are architecture constraints.
- `connect-src` follows the approved endpoint model and must not be widened to `*`, `https:` or `http:`.
- Approved origins use canonical exact-origin serialization; HTTPS is mandatory except for explicit loopback development origins.
- Permissions-Policy feature identifiers are emitted and validated as exact lowercase tokens. Unknown or differently cased dictionary members may be ignored by user agents and therefore cannot satisfy required disablement controls.
- Required powerful features are explicitly disabled with the canonical empty inner list `()`.
- CSP is defense in depth, not a substitute for safe rendering, input validation or authorization.
- Security headers are generated from a machine-readable baseline and must fail CI on unsafe structural, casing, duplicate-name or value-level changes.
- HSTS requires a valid `max-age` at or above the project floor and `includeSubDomains`; preload remains an explicit deployment commitment.

### Accessibility

- W3C Web Content Accessibility Guidelines 2.2 Recommendation:
  - `https://www.w3.org/TR/WCAG22/`
- WAI-ARIA Authoring Practices are used only when native HTML cannot provide the required semantics.

Project rules:

- Automated scanners provide partial evidence only.
- Manual keyboard, focus, zoom/reflow and assistive-technology tests are required for the critical flow.
- APP-01 must not claim full WCAG conformance without a complete, scoped conformance evaluation.

### Secure development and supply chain

- NIST SP 800-218, Secure Software Development Framework 1.1:
  - `https://csrc.nist.gov/pubs/sp/800/218/final`
- SLSA Provenance specification 1.2:
  - `https://slsa.dev/spec/v1.2/provenance`
- SBOM format: an explicitly selected SPDX or CycloneDX version, pinned in the release ADR.

Project rules:

- SBOM existence is not equivalent to completeness or release integrity.
- Provenance, pinned dependencies/actions, vulnerability response and reproducible verification are separate controls.
- CI evidence records tool versions, runtime, source commit and artifact digest.
- Public GitHub Actions are pinned to immutable commit SHAs where practical and run with minimum permissions.

## Research use

Before a paper-derived control becomes mandatory:

1. State the claim, architecture assumptions and limitations.
2. Verify whether the threat applies to APP-01's chosen endpoint and deployment model.
3. Reproduce a minimal attack or negative test when feasible.
4. Map the result to a requirement, control, test and evidence artifact.
5. Mark unresolved findings as research risk rather than established protocol fact.

## Citation and freshness policy

Every normative requirement in an ADR, security profile or release gate records:

- source title and URL;
- exact version/revision;
- publication/revision date;
- retrieval date and timezone;
- affected requirement or risk IDs;
- supersession review trigger.

Review triggers:

- MCP revision or selected contract version changes;
- endpoint/deployment/OAuth model changes;
- Permissions Policy grammar, feature registry or supported browser behavior changes;
- supported browser matrix changes;
- major runtime, dependency or CI-tool upgrade;
- public-release preparation;
- newly disclosed vulnerability affecting a selected component.

## Corrections retained from prior reviews

- Secondary summaries are not authoritative support for WCAG, CSP, OAuth or MCP requirements.
- Unreproduced MCP security papers are threat-discovery inputs, not normative facts.
- Fail-closed applies to unsupported mandatory/security-relevant semantics, not every harmless extension field.
- Memory-only credentials are one control, not a complete browser authorization design.
- Production-ready remains prohibited until implementation, verification, deployment, rollback and operational gates pass.
