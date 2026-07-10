# APP-01 Privacy Model — M1

- Status: GOOD-DRAFT
- Date: 2026-07-10

## Default posture

Data minimization, local transparency and no telemetry by default. APP-01 must show what endpoint receives which data before transmission.

## Data classes

| Class | Examples | Default handling |
|---|---|---|
| Public configuration | UI language, theme | local persistence allowed |
| Endpoint metadata | origin, display name, capabilities | session-only by default; explicit save may be added after review |
| Sensitive content | prompts, resources, tool arguments/results | memory-only; never analytics or cache |
| Credentials | access/refresh tokens, authorization codes, session secrets | memory-only; never localStorage, IndexedDB, URL, logs or export |
| Operational evidence | normalized error category, timings | local and redacted; telemetry opt-in only after separate decision |

## User controls

- Connection and endpoint identity are always visible.
- Each first use of a capability requires explicit approval.
- Material capability changes invalidate prior approval.
- Disconnect and clear-session controls remove in-memory content and client state.
- Copy/export actions are explicit and warn when content may be sensitive.
- No dark patterns, preselected consent or bundled consent.

## Storage policy

M1 stores no prompts, results, credentials or session identifiers persistently. A service worker must not be introduced until cache keys, eviction and sensitive-response exclusions are specified and tested. Browser autofill must be disabled for token fields where applicable.

## Network policy

Only user-approved MCP origins may receive MCP data. Production connections use HTTPS. Third-party analytics, advertising, remote fonts and unrelated CDNs are prohibited in the baseline build. Referrer leakage is prevented through an appropriate Referrer-Policy.

## Logging and diagnostics

Logs use allowlisted fields, not raw payloads. Tokens, authorization headers, query secrets, prompts, resources and results are redacted or omitted. Debug mode is visibly enabled and must not weaken credential handling.

## Retention

- Session content: until disconnect, clear-session, navigation teardown or configured inactivity timeout.
- Persistent non-sensitive preferences: until user clears them.
- Server-side retention: outside APP-01 control and must be disclosed from endpoint metadata or operator documentation before sensitive use.

## Verification

E2E tests inspect localStorage, sessionStorage, IndexedDB, Cache Storage, URL/history and console output after representative sensitive flows. Release fails when sensitive fixtures remain in any prohibited sink.
