# Research provenance — issue #8 security auflagen (2026-07-10)

Sources backing the four security auflagen fixes, with confidence tiers
(high = authoritative/primary spec or standard; medium = reputable secondary
analysis). All web-retrieved 2026-07-10 by Codie.

## 1. CSP `connect-src` (exfiltration control)

- content-security-policy.com/connect-src — directive scope (fetch, XHR,
  WebSocket, EventSource, `<a ping>`, `sendBeacon`); explicit-origin allowlist
  over wildcards. <https://content-security-policy.com/connect-src/> (high)
- MDN Content-Security-Policy — multiple policies only tighten, never loosen;
  directive reference. <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy> (high)
- OWASP CSP Cheat Sheet. <https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html> (high)
- Auth0 — deploying CSP in SPAs. <https://auth0.com/blog/deploying-csp-in-spa/> (medium)

## 2. Contract signature + provenance (Sigstore/cosign + SLSA)

- Sigstore cosign verifying docs. <https://docs.sigstore.dev/cosign/verifying/verify/> (high)
- Sigstore keyless signing (Fulcio short-lived cert, Rekor transparency log,
  OIDC). <https://www.systemshardening.com/articles/cicd/sigstore-keyless-signing/> (high)
- Cosign + SLSA provenance (signature proves artifact unchanged since
  provenance; provenance proves build legitimacy).
  <https://aquilax.ai/blog/supply-chain-artifact-signing-slsa> (medium)
- SLSA framework build levels & provenance.
  <https://www.decryptiondigest.com/blog/slsa-software-supply-chain-framework-guide> (medium)

## 3. OWASP Top 10 for Agentic Applications 2026 (ASI01/ASI02) + MCP security

- OWASP Gen AI Security Project — Top 10 for Agentic Applications 2026.
  ASI01 Agent Goal Hijack (EchoLeak-class indirect injection); ASI02 Tool
  Misuse and Exploitation; least-agency/least-privilege mitigation.
  <https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/> (high)
- Full ASI01–ASI10 list corroborated via promptfoo mapping.
  <https://www.promptfoo.dev/docs/red-team/owasp-agentic-ai/> (medium)
- MCP Security Best Practices — confused deputy (per-client consent), token
  passthrough forbidden (audience validation), session-hijacking, SSRF,
  CSP recommendation for web MCP clients.
  <https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices> (high)

## 4. Minimal-CI (house pattern)

- Reference workflows in hardened coworkerz repos (hqst-cmb `ci.yml`, phi-hex
  `zizmor.yml`): top-level `permissions: {}`, SHA-pinned public actions,
  `persist-credentials: false`, inline (no private reusable). Retrieved via
  `gh api` 2026-07-10.

## ASI01–ASI10 (2026) for reference

ASI01 Agent Goal Hijack · ASI02 Tool Misuse and Exploitation · ASI03 Identity
and Privilege Abuse · ASI04 Agentic Supply Chain Vulnerabilities · ASI05
Unexpected Code Execution · ASI06 Memory and Context Poisoning · ASI07
Insecure Inter-Agent Communication · ASI08 Cascading Failures · ASI09 Human
Agent Trust Exploitation · ASI10 Rogue Agents.
