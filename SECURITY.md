# Security Policy

## Supported state

APP-01 `browser` is currently pre-release. No version is production-supported yet.
Security fixes are applied to the default branch and to any explicitly listed
release line after the first public release.

| Version | Supported |
|---|---|
| `main` / active pre-release branch | Yes |
| Unlisted tags, forks and historical commits | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, leaked credential,
private endpoint, exploit path or sensitive log.

Preferred reporting path:

1. Open a private GitHub Security Advisory for this repository through the
   repository's **Security → Advisories → New draft security advisory** flow.
2. Include the affected commit or version, attack prerequisites, impact,
   minimal reproduction steps and any proposed mitigation.
3. Remove real secrets, personal data and production credentials from the
   report. Use synthetic values and redact logs.

If private advisory creation is unavailable, contact the repository owner
through an already established private channel and reference this policy.
Do not create a public fallback issue containing exploit details.

## Response targets

These are operational targets, not guarantees:

- acknowledgement: within 3 business days;
- initial severity and scope assessment: within 7 business days;
- critical active-exploitation mitigation target: as soon as practicable,
  normally within 72 hours after confirmation;
- coordinated disclosure: after a fix, verification and affected-user guidance
  are ready.

The response may request additional evidence, reject reports that do not affect
this repository, or coordinate with an upstream owner such as ENG-01 when the
fault lies in a consumed contract or dependency.

## Severity and release handling

Triage considers exploitability, required privileges, affected data,
confidentiality/integrity/availability impact, user interaction, scope and
whether a security boundary is bypassed.

Confirmed vulnerabilities require:

- a tracked private remediation plan;
- a regression test or documented reason why one is infeasible;
- review of related attack variants;
- a release or deployment plan, including rollback;
- an advisory and credit when appropriate;
- rotation or revocation of exposed credentials and sessions when applicable.

## Security boundaries

High-value boundaries include:

- CSP and the exact-origin `connect-src` allowlist;
- security-header generation and delivery;
- endpoint and redirect validation;
- MCP protocol/version and capability validation;
- consent and capability authorization;
- credential, token and session handling;
- safe rendering of untrusted MCP content;
- contract-artifact provenance and dependency integrity;
- CI workflows and release artifacts.

## Safe-harbor intent

Good-faith research that avoids privacy violations, service disruption,
persistence, data destruction, credential misuse and unnecessary access will be
handled constructively. Stop testing and report immediately if sensitive data,
credentials or access to another user's resources is encountered.
