# Web BYOK text tracer

Settings → AI power enables an independent direct-device connection and text
continuation tracer. It stores one account preference (`local`, `byok` with
`openrouter`, or owner-approved private `pro`) through a strict schema. Private Pro selection requires audited eligibility; provider capability gates remain independent. This tracer does not submit an app AI operation or debit Pro credits.
Legacy chat and provider routes are now closed, with explicit unavailable messaging;
this connection check does not enable images, narration, agents, or paid search.

The password input has no form name, so native submission before hydration cannot
serialize it. Validation clears the input and sends a bounded 16-token request
only to `https://openrouter.ai/api/v1/chat/completions`. Continuations use the
shared autocomplete core, a fixed `openai/gpt-4.1-mini` configuration, and a
64-token ceiling. Requests omit cookies, reject redirects, have a 30-second
request timeout, and never retry or fall back to app-owned keys. Provider errors
and invalid/echoed output become fixed non-secret diagnostics.

The usable key lives in page memory. Replacement/removal invalidates opaque
references; logout, account changes, session expiration, and `pagehide` remove
it. Already-dispatched requests can still incur provider charges. Retired keys
are represented by SHA-256 fingerprints and non-recoverable prefix/length
metadata, allowing late egress checks without retaining usable retired keys.
The detector recognizes raw values, nested URI/base64 representations, JSON
Unicode escapes, hexadecimal text, and HTML numeric entities. It is an accidental
application-egress boundary, not protection against malicious same-origin code,
third-party extensions, or arbitrary custom encryption.

After a key has been registered, fetch, XHR, beacons, console/error event
reporting, browser storage setters, cookies, and IndexedDB writes are guarded.
Fetch inspects cloned body bytes before dispatch, including blobs and multipart
uploads. XHR validates its queued URL/headers again at send time. Synchronous
opaque binary XHR/beacon/storage payloads fail closed for a protected session;
ordinary sessions without a registered key retain those paths. Fetch supports
non-secret binary uploads in protected sessions. New transport request bodies and preference writes use explicit allowlisted
shapes: fixed model/messages/token settings and literal power/provider identity.
The provider response parser exposes only validated text, excluding raw SDK
envelopes. An additional application-egress denylist rejects common SDK/config
fields; it does not replace existing application payload schemas. No finished-artifact sync flow is introduced in this ticket.

## Direct browser verification, 2026-10-10

[OpenRouter's browser authorization guide](https://openrouter.ai/docs/guides/overview/auth/oauth)
shows browser-held keys and direct JavaScript fetch. The primary public models
API listed `openai/gpt-4.1-mini`, text output, and `max_tokens` support on the
verification date.

An OPTIONS probe to the exact chat-completions endpoint returned HTTP 204,
`Access-Control-Allow-Origin: *`, POST support, and Authorization/Content-Type
header support. A real local browser then sent a POST with `credentials: omit`,
`redirect: error`, and an intentionally invalid test token. JavaScript could
read the HTTP 401 response (`type: cors`, no redirect). Probe evidence is in
`/tmp/lexidraw-276-implementation/278-provider-cors.json` for this implementation
session. This proves browser access to the endpoint and its authentication
response, not successful authenticated generation or account permissions.

Successful authenticated generation has not been smoke-tested with a real
OpenRouter key. Each device's Validate key action is the paid capability check;
failure leaves it unavailable. Full authenticated settings/browser QA remains
for the final integration QA ticket. Deterministic tests intercept transport
requests and prove credential egress, not real provider service availability.

## Local verification

Tests were written before implementation. The initial transport test failed
because the session module did not exist, then passed after implementation.
Subsequent red/green slices demonstrated encoded-secret leakage, arbitrary
runtime provider selection/config shapes, shared-core autocomplete dispatch,
queued XHR leakage, persistent property/cookie leakage, and native form
serialization before hydration.

Run `bun test --cwd apps/lexidraw src/lib/byok
src/app/settings/provider-key-input.test.tsx` and
`bun run --cwd apps/lexidraw test:ts`. The larger app suite has known baseline
failures recorded by the preceding shared-core ticket; no cloud build,
deployment, or paid CI provider request is needed for these local checks.
