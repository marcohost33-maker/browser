# APP-01 MCP Consumer Profile — M1

- Status: PROPOSED / blocked on ENG-01 contract publication
- Owner of protocol contract: ENG-01 `nigin-engine`
- Consumer: APP-01 `browser`

## Purpose

This profile states what APP-01 needs from ENG-01 without redefining MCP or becoming contract owner.

## Required ENG-01 inputs

1. Pinned MCP protocol version and supported transport profile.
2. Machine-readable schemas/types and integrity identifier.
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

## Fail-closed rules

Reject unsupported protocol versions, unknown mandatory fields, capability use not present in the negotiated snapshot, endpoint identity changes, unapproved operations, oversized payloads, invalid content types and responses after cancellation.

## Test vectors

ENG-01 fixtures must include malformed JSON-RPC, wrong IDs, duplicate/out-of-order responses, capability changes, unauthorized errors, rate limits, timeout, cancellation race, oversized content, malicious markup, redirect attempts and session replay.

## Definition of ready

Implementation may begin when ENG-01 supplies a versioned artifact and at least one deterministic read-only conformance flow. Until then, APP-01 may build only the adapter seam, mocks and UI state machine.