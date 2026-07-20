# ADR-003 — Endpoint Trust, Browser Transport and Deployment

- Status: SUPERSEDED by ADR-005 (offline runtime trust classes)
- Date: 2026-07-11
- Superseded: 2026-07-14
- Scope: APP-01 `browser` M1
- Owner issue: #13
- Blocked by: #14 product evidence and representative endpoint spike

> **SUPERSEDED (2026-07-14).** This ADR was drafted (Status: PROPOSED — never
> ACCEPTED) around the obsolete product framing of `browser` as a browser-based MCP
> *client* that connects to a curated set of **remote** HTTPS MCP endpoints. Marco's
> 2026-07-14 decision reframes `browser` into a native, offline-capable runtime that
> executes arbitrary foreign web apps **locally** (trust-class target **T3**),
> replacing cloud hosting and running without any AI layer. The binding reframe
> record is **ADR-005/006/007** (see PR #22); `browser` is **standalone** per
> **ADR-008** (2026-07-16), with MCP consumption an internal, optional capability off
> the T1 critical path and no external `nigin-engine` dependency. The
> remote-endpoint-marketplace and
> direct-browser-transport product model below is therefore obsolete. Its
> *network-security substance* — egress origin allowlist, exact-origin `connect-src`,
> separation of endpoint URL vs. canonical origin, redirect/DNS-rebinding/
> private-network/metadata-service rejection, fail-closed on unapproved origins —
> remains framing-neutral and applies equally to the network egress of locally
> hosted apps; that substance is preserved and lives on in `docs/security/*`. Do not
> treat the "curated remote endpoint" product decision below as current.

## Context

A browser MCP client cannot treat endpoint selection as a simple text field.
Endpoint topology determines CSP, CORS, redirects, credentials, OAuth, privacy,
availability, monitoring and support boundaries.

The MCP Streamable HTTP transport uses one endpoint URL that may contain a path.
CSP `connect-src`, however, authorizes origins. APP-01 therefore treats these as
different values:

- **Endpoint URL:** full HTTPS URL used by the MCP adapter, including path.
- **Network origin:** canonical `scheme://host[:port]` used by CSP and the
  deployment allowlist.

Approval of one does not implicitly validate the other.

## Decision proposal

For M1, APP-01 supports only a **curated, deploy-time set of controlled HTTPS
MCP endpoints**. The application may let a user choose among that set but may not
widen it at runtime or accept an arbitrary new remote origin.

A direct browser-to-MCP connection is permitted only when the endpoint passes a
versioned compatibility profile covering CORS, transport, authentication,
redirect behavior, protocol headers, limits and operational ownership.

When the direct-browser profile cannot be satisfied safely, APP-01 uses a
separately designed same-origin gateway or does not support that endpoint. The
application must never weaken CSP or credential policy merely to make a remote
endpoint connect.

Plain HTTP is restricted to explicit loopback development endpoints:
`localhost`, `127.0.0.1` and `::1`.

## Alternatives

### A. Arbitrary user-entered remote endpoints

Rejected for M1.

Reasons:

- a document-delivered CSP cannot be widened safely after load;
- arbitrary servers may not allow the application origin through CORS;
- redirect, DNS rebinding, private-network and credential risks become
  unbounded;
- endpoint ownership, privacy and incident support are unclear;
- user approval is not equivalent to technical trust.

This may be reconsidered only as a new product and threat-model decision.

### B. Curated direct browser endpoints

Proposed M1 default when the endpoint profile passes.

Advantages:

- low infrastructure cost;
- direct user-to-endpoint data path;
- deployment CSP can enumerate exact origins;
- endpoint/operator responsibility can be stated clearly.

Constraints:

- endpoint must explicitly support the APP-01 browser origin and required
  methods/headers;
- browser credentials and OAuth behavior remain constrained;
- each endpoint is a tested integration, not a generic promise.

### C. Same-origin gateway or backend-for-frontend

Accepted fallback architecture, but not implicitly selected.

Advantages:

- CSP can remain `connect-src 'self'`;
- browser CORS complexity is removed from the remote MCP contract;
- server-side credential containment, rate limiting and policy enforcement are
  possible.

Costs and risks:

- additional service, operational cost and availability boundary;
- the gateway becomes a processor of user/MCP data and a high-value target;
- SSRF, tenant isolation, logs, retention and credential storage require a
  separate threat model;
- conflicts with a purely static/zero-backend deployment goal.

### D. Separate trust tiers

Deferred. A multi-tier endpoint marketplace increases product and consent
complexity before the primary M1 task has been validated.

## Direct-browser endpoint compatibility profile

A production endpoint must provide evidence for all applicable items:

### URL and origin

- full endpoint URL is canonical HTTPS;
- no userinfo, fragment or embedded credentials;
- origin appears exactly in the served CSP/deployment allowlist;
- redirects are disabled or limited to an explicitly approved canonical target;
- loopback/private/link-local/cloud-metadata destinations are rejected unless a
  separate local-development mode explicitly permits loopback.

### CORS

- `Access-Control-Allow-Origin` is the exact APP-01 origin, never `*` for a
  credentialed flow;
- allowed methods cover the selected MCP transport only;
- allowed request headers include the exact MCP/auth headers used by the pinned
  contract;
- required response headers, such as session identifiers, are exposed when the
  browser must read them;
- preflight, redirect and credential behavior is tested in every supported
  browser class.

### MCP transport

- Streamable HTTP behavior matches the pinned protocol revision;
- protocol-version headers are sent and validated after initialization;
- session identifiers are treated as routing/session state, not authentication;
- event-stream reconnect, message ordering, cancellation and disconnect
  semantics are deterministic and bounded;
- Origin validation and authentication are enforced by the server.

### Authorization

- no OAuth is assumed unless the selected contract profile enables it;
- public browser OAuth uses Authorization Code with PKCE;
- redirect URIs are exact and pre-registered;
- state, issuer and authorization-server identity are validated;
- access tokens are audience-restricted and never passed through to a different
  upstream service;
- tokens are absent from URLs, logs and prohibited persistent storage.

### Limits and reliability

- connection, request, idle and total deadlines are defined;
- response bytes, JSON depth, collection counts and rendered output are bounded;
- retry and reconnect behavior is idempotency-aware and rate-limited;
- endpoint ownership, support contact, maintenance window and deprecation policy
  are known.

## Configuration model

Deployment configuration separates:

1. endpoint identifier and display name;
2. full MCP endpoint URL;
3. canonical CSP origin;
4. trust tier and operator identity;
5. expected protocol/contract revision;
6. authorization profile;
7. CORS/transport conformance evidence digest;
8. expiry/review date.

The build fails when endpoint URLs and approved origins are inconsistent. A UI
selection cannot add an origin that is absent from the served policy.

The CSP serializer uses `CSP_APPROVED_ORIGINS`, whose values are canonical
origins rather than full endpoint URLs. `CSP_APPROVED_ENDPOINTS` remains a
temporary deprecated alias; setting both names is a configuration error.

## Verification spike

For at least one representative endpoint and every supported browser engine:

1. exercise preflight and actual initialization;
2. record request/response headers without secrets;
3. verify exact origin behavior and blocked unapproved origins;
4. test redirects, timeout, abort, reconnect and server disconnect;
5. verify protocol-version and session-header behavior;
6. test credential-free and selected authorization modes;
7. confirm no sensitive values reach prohibited browser sinks;
8. compare direct transport against same-origin gateway fallback.

Raw evidence records browser/version, endpoint test identity, commit, date,
commands, sanitized network trace and pass/fail criteria.

## Acceptance criteria

ADR-003 can become ACCEPTED only when:

- #14 selects a primary user/task compatible with the topology;
- at least one representative production endpoint passes the profile;
- CSP can remain exact-origin without wildcard or scheme-source widening;
- CORS and authorization behavior are reproducible across the supported browser
  matrix;
- privacy and operational ownership are documented;
- threat-model and rollback implications are reviewed;
- rejected alternatives and migration triggers remain explicit.

## Consequences

- Runtime work remains blocked until this ADR is accepted.
- M1 cannot promise compatibility with arbitrary MCP servers.
- A curated endpoint may still be unavailable or incompatible; failures must be
  visible and must not trigger security-policy relaxation.
- A future gateway, marketplace or local-server mode requires a new ADR and
  threat-model delta.

## Primary sources

- MCP Streamable HTTP transport:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/transports`
- MCP authorization:
  `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization`
- MCP security best practices:
  `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
- Fetch Standard: `https://fetch.spec.whatwg.org/`
- MDN CORS guide:
  `https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS`
- RFC 9700 OAuth 2.0 Security Best Current Practice:
  `https://www.rfc-editor.org/rfc/rfc9700`
- RFC 7636 Proof Key for Code Exchange:
  `https://www.rfc-editor.org/rfc/rfc7636`
