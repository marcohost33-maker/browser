# APP-01 MCP Consumer Profile — M1

- Status: PROPOSED / blocked on ENG-01 contract publication
- Owner of protocol contract: ENG-01 `nigin-engine`
- Consumer: APP-01 `browser`

## Purpose

This profile states what APP-01 needs from ENG-01 without redefining MCP or becoming contract owner.

## Required ENG-01 inputs

1. Pinned MCP protocol version and supported transport profile.
2. Machine-readable schemas/types delivered as a **signed artifact with build
   provenance** (Sigstore/cosign signature + SLSA provenance), not a bare hash.
   APP-01 verifies signature, provenance and transparency-log inclusion before
   trust — see [ADR-002](../docs/adr/ADR-002-contract-artifact-signing.md). A
   digest is retained only as a secondary integrity check.
3. Initialization and capability-negotiation fixtures.
4. Read-only success fixture and normalized error fixtures.
5. Cancellation, timeout and disconnect expectations.
6. Authorization profile, or an explicit statement that M1 uses no OAuth.
7. Compatibility and deprecation policy.
8. Conformance endpoint or deterministic mock server.

## APP-01 supported M1 surface

- Initialize a stateful client connection.
- Negotiate and display server capabilities.
- Execute exactly one approved read-only operation selected from the ENG-01 fixture set.
- Handle progress only when bounded and explicitly supported.
- Cancel an in-flight request.
- Normalize transport, protocol, authorization, timeout, cancellation and validation errors.

Sampling, elicitation, roots mutation, write tools, autonomous chaining and local-server execution are disabled unless a later profile explicitly enables them.

## Adapter contract

The UI calls an application interface, never raw JSON-RPC:

```ts
interface McpClientPort {
  connect(config: ConnectionConfig, signal: AbortSignal): Promise<ConnectionSnapshot>;
  listCapabilities(signal: AbortSignal): Promise<CapabilitySnapshot>;
  invokeReadOnly(request: ApprovedReadRequest, signal: AbortSignal): Promise<SafeResult>;
  disconnect(): Promise<void>;
}
```

Concrete names and generated types must come from the pinned ENG-01 artifact. Runtime validation is required at every external boundary even when compile-time types exist.

## Endpoint allowlist mechanic (ASI02 — tool misuse)

The set of MCP endpoints APP-01 may reach is governed by a **two-tier
allowlist**, deny-by-default:

1. **Curated baseline allowlist** — a vetted set of endpoint origins compiled
   into the deployment and reflected 1:1 in the served CSP `connect-src`
   (see [CSP profile](../docs/security/CSP_AND_SECURITY_HEADERS.md)). This is
   the trusted default set.
2. **User-added endpoints** — permitted only with explicit, informed consent,
   session-scoped by default, HTTPS-only in production, exact-origin match.

Binding rule: a user-added endpoint can take effect **only if the served CSP
`connect-src` already permits its origin**. In a strict-CSP static deployment,
an origin outside the curated policy **fails closed** (visible error) rather
than silently widening the exfiltration surface. `connect-src` is never
widened to `*` or `https:`; supporting arbitrary user endpoints requires a
same-origin proxy or per-deployment policy regeneration, each its own reviewed
decision. This is the enforcement half of the ASI02 tool/endpoint-misuse
control ([OWASP Top 10 for Agentic Applications 2026, ASI02 Tool Misuse and
Exploitation](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/),
confidence: high).

## Untrusted result content and downstream re-review (ASI01 — goal hijack)

All MCP result content (tool output, resource text, annotations, prompts) is
**untrusted data**. In M1 it is rendered for **human review only** and never
interpreted as instructions. The moment any result content is fed back into an
agent, an LLM prompt, or any automated decision path — rather than to a human
— the injection threat is re-classified as **ASI01 Agent Goal Hijack** (the
EchoLeak-class indirect-injection pattern, where untrusted content silently
redirects an agent's objective) and MUST undergo a fresh injection/threat
re-review **before** that path is enabled. M1 enables no such downstream
automated consumption
([OWASP Top 10 for Agentic Applications 2026, ASI01 Agent Goal Hijack](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/),
confidence: high).

## Fail-closed rules

Reject unsupported protocol versions, unknown mandatory fields, capability use not present in the negotiated snapshot, endpoint identity changes, unapproved operations, oversized payloads, invalid content types and responses after cancellation.

## Test vectors

ENG-01 fixtures must include malformed JSON-RPC, wrong IDs, duplicate/out-of-order responses, capability changes, unauthorized errors, rate limits, timeout, cancellation race, oversized content, malicious markup, redirect attempts and session replay.

## Definition of ready

Implementation may begin when ENG-01 supplies a versioned artifact and at least one deterministic read-only conformance flow. Until then, APP-01 may build only the adapter seam, mocks and UI state machine.
