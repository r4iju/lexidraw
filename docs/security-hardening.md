## Problem Statement

A black-box test of production on 2026-11-11 found no cross-account access,
privilege escalation, script execution in HTML blocks, or server-side fetch of
private addresses. It did find gaps at the edges of the account and entity
model that a stranger can use against real users:

- **Blank sign-up.** `auth.signUp` with an empty body inserted a user whose
  email, name and password are all empty, and answered success. A repeat
  answers 500. One such row now exists in production, created by the test.
- **Sign-up 500 on a taken email.** The unique-email constraint surfaces as an
  internal error rather than an answer the form already knows how to show.
- **Victim lockout.** Ten sign-in attempts for an email inside a fixed
  15-minute window refuse even the correct password until the window ends.
  The count rises on every attempt, so anyone who knows a user's email can
  keep them locked out indefinitely with ten requests per quarter hour.
- **Free-form entity ids.** Create accepts any string as an id: empty,
  whitespace, 5,000 characters, `__proto__`, markup, or a path such as
  `../settings`. Links built from the id are not encoded, so a shared entity
  whose id is `../settings` appears on the recipient's dashboard as a normal
  file that opens `/settings`. Shares need no acceptance, so any user can plant
  such a row for any other user. Entities created through the API with an id
  that is not a UUID are listed on the dashboard but cannot be opened.
- **No browser security headers.** Pages send only HSTS: nothing prevents
  framing (clickjacking), MIME sniffing, or full-URL referrers, and there is
  no content security policy behind the sanitizers.
- **Extractor errors.** A blocked article URL (private address, non-http
  scheme) answers 500 instead of 400, and any port on a public host can be
  fetched, which lets a user probe or hold connections to arbitrary services.

## Solution

Close each gap at its source, keeping every shipped client working:

- Sign-up validates every field on the server with no empty defaults, answers
  a taken email with a conflict the sign-up form already explains, and stores
  emails normalized.
- Sign-in throttling counts failed attempts per email and client, so a
  stranger's failures cannot lock out the real user; a higher per-email ceiling
  stays as a backstop against distributed guessing.
- New entity ids must be canonical lowercase UUIDs, the format every shipped
  client already sends. Every link built from an entity id is encoded, and the
  drawing and link pages reject malformed ids the way the document page does.
- Every response carries clickjacking, sniffing and referrer protection. A
  content security policy ships in report-only mode, to be enforced once it is
  shown not to break embeds, storage, analytics or editors.
- The article extractor answers 400 for any URL it refuses, accepts only
  `http` and `https`, and fetches only ports 80 and 443.

## User Stories

### Sign-up

1. As a visitor, I want sign-up to reject a request missing a name, email or
   password, so that no account can exist without credentials.
   - S1.1 A sign-up with an empty body, or with any field missing, is refused
     with a validation error and creates no user.
   - S1.2 A sign-up whose email, name or password is an empty string is
     refused with a validation error and creates no user.
   - S1.3 A sign-up with a malformed email or a password failing the existing
     strength rules is refused with the same field errors the form shows today.
2. As a visitor whose email is already registered, I want a clear refusal, so
   that I know to sign in instead.
   - S2.1 Signing up with a registered email answers a conflict, not an
     internal error, and changes nothing about the existing account.
   - S2.2 The sign-up form shows its existing "If you already have one, sign
     in instead" message for that answer.
   - S2.3 The registered-email check ignores letter case and surrounding
     whitespace: `Person@Example.com ` conflicts with `person@example.com`.
3. As a new user, I want my email stored in one canonical form, so that I can
   sign in however I capitalize it.
   - S3.1 A new account's email is stored trimmed and lowercased.
   - S3.2 Credentials sign-in finds the account whatever the case or
     surrounding whitespace of the typed email, including accounts created
     before this change with mixed-case emails.
4. As an operator, I want blank or malformed sign-in input refused as an
   ordinary failed sign-in, so that it does not surface as a configuration
   error.
   - S4.1 Credentials sign-in with an empty email or password redirects with
     the ordinary credentials error, not the configuration error page.

### Sign-in throttling

5. As a user, I want to sign in with my correct password even while a stranger
   is failing to guess it, so that knowing my email is not enough to lock me
   out.
   - S5.1 After any number of failed attempts for an email from one client, a
     correct password from a different client signs in, as long as the
     per-email ceiling has not been reached.
   - S5.2 Successful sign-ins do not count toward any limit.
   - S5.3 A successful sign-in clears the failure count for that email and
     client.
6. As the owner, I want password guessing against one account from one client
   to be slowed, so that online guessing stays impractical.
   - S6.1 After 10 failed attempts for one email from one client inside the
     window, further attempts for that email from that client are refused
     without verifying the password, until the window ends.
   - S6.2 A refused attempt is indistinguishable from a wrong password to the
     caller, and is logged by code only.
7. As the owner, I want a backstop against guessing one account from many
   clients, so that rotating addresses does not remove the limit.
   - S7.1 After 100 failed attempts for one email across all clients inside
     the window, further attempts for that email are refused without verifying
     the password, until the window ends.
8. As the owner, I want the existing per-client ceiling kept, so that one
   client cannot spray many accounts.
   - S8.1 After 30 attempts from one client inside the window, attempts for
     any email from that client are refused, as today; other clients are
     unaffected.
9. As the owner, I want a limiter that cannot count to stay out of the way, as
   today.
   - S9.1 When the limiter's store fails, sign-in proceeds and the failure is
     logged by code only.

### Entity ids

10. As an API client, I want a clear error when I send a malformed entity id,
    so that I never create something the web app cannot open.
    - S10.1 Creating an entity (any type, through the REST API, MCP or the web
      app's own calls) with an id that is not a canonical lowercase UUID is
      refused with a validation error and creates nothing.
    - S10.2 Refused ids include the empty string, whitespace, uppercase UUIDs,
      UUIDs with braces or without dashes, ids containing `/`, `.`, `%`, or
      markup, and ids longer than a UUID.
    - S10.3 Creating with a canonical lowercase UUID behaves exactly as today,
      including returning the existing entity on a repeat by its owner and the
      conflict for an id another user holds.
    - S10.4 Creating a drawing without an id still assigns a fresh UUID.
11. As a user, I want every link to a file to open that file, so that a shared
    file cannot send me somewhere else in the app.
    - S11.1 Every link, copy-link value and redirect built from an entity id
      encodes the id as a single path segment.
    - S11.2 An entity whose id contains `/`, `..` or `?` (a legacy or planted
      row) links to its own entity page, which answers not found, and never
      to another route.
12. As a user, I want document, drawing and link pages to answer not found for
    an id that cannot exist, so that malformed URLs do no work.
    - S12.1 The document, drawing and link pages answer not found, without
      loading data, for an id that is not a canonical lowercase UUID.
    - S12.2 Opening any existing entity with a canonical UUID id works as
      today on all three pages.
13. As the owner, I want existing entities left untouched, so that nothing
    already stored disappears from the API.
    - S13.1 No stored id is rewritten or deleted by this change.
    - S13.2 API reads, updates, moves, shares and deletes by id accept any
      stored id, as today.

### Browser security headers

14. As a user, I want Lexidraw pages to refuse to be framed by other sites, so
    that I cannot be tricked into clicking inside a hidden Lexidraw page.
    - S14.1 Every page response forbids framing by other origins, through both
      a content security policy `frame-ancestors 'self'` directive and
      `X-Frame-Options: SAMEORIGIN`.
    - S14.2 The native sign-in page keeps forbidding all framing, including
      same-origin framing.
    - S14.3 The document screenshot route, which frames same-origin pages,
      keeps working.
15. As a user, I want responses never sniffed into another content type, so
    that uploaded or generated content cannot run as script.
    - S15.1 Every response, pages and API alike, carries
      `X-Content-Type-Options: nosniff`.
16. As a user, I want links I follow out of Lexidraw not to reveal which
    document I was reading, so that file ids do not leak to other sites.
    - S16.1 Every page response carries
      `Referrer-Policy: strict-origin-when-cross-origin`.
17. As the owner, I want a content security policy I can enforce later without
    guessing, so that the sanitizers have a backstop without risking a broken
    release.
    - S17.1 Every page response carries a
      `Content-Security-Policy-Report-Only` header listing the origins the app
      loads scripts, styles, images, media, fonts, frames, workers and
      connections from.
    - S17.2 Walking through the editor, drawings, slides, embeds (YouTube,
      Figma, Twitter), uploads, Unsplash images, narration, BYOK text, HTML
      blocks and the screenshot route on a local production build reports no
      violation for intended behaviour.
    - S17.3 No response gains an enforced content security policy beyond the
      `frame-ancestors` directive in S14.1.

### Article extractor

18. As an API client, I want a URL the extractor refuses to answer as my
    mistake, so that I can tell refusals from outages.
    - S18.1 Extracting a URL that resolves to a private, loopback, link-local
      or otherwise non-public address answers 400 with a message saying the
      address is not public.
    - S18.2 A redirect to a non-public address answers the same 400.
    - S18.3 A URL with a scheme other than `http` or `https` is refused by
      input validation with 400.
    - S18.4 The same refusals answer 400 wherever the extractor runs: article
      extraction, distilling a link entity, and the agent web and sandbox
      tools.
19. As the owner, I want the extractor to fetch only web ports, so that users
    cannot use Lexidraw to probe or hold open other services.
    - S19.1 A URL with an explicit port other than 80 for `http` or 443 for
      `https` is refused with 400 before any connection is made.
    - S19.2 A redirect to such a port is refused the same way.
    - S19.3 URLs with no port, or with the scheme's default port spelled out,
      extract as today.
20. As an operator, I want genuine extractor failures still reported as
    failures, so that outages stay visible.
    - S20.1 A timeout or network error reaching a public address is not
      reported as a 400.

## Implementation Decisions

### Sign-up

- The server-side sign-up input gets its own schema, separate from the form's
  schema. The form keeps its empty defaults for controlled inputs; the server
  schema requires every field and applies the existing name, email and
  password rules with no defaults. The defaults were the cause of the blank
  row: missing fields took the empty default without running the email,
  length or strength checks.
- Email normalization (trim, lowercase) happens in the server schema, so the
  stored value and the duplicate check share one form.
- A registered email is detected before insert, case-insensitively, and the
  procedure answers `CONFLICT`. The unique-constraint violation also maps to
  `CONFLICT`, covering a race between check and insert. Other database errors
  remain internal errors.
- Account enumeration through sign-up is accepted, since sharing by email
  already reveals whether an address is registered (accepted in triage).
- Credentials sign-in normalizes the typed email the same way and looks the
  account up case-insensitively, so accounts stored before this change with
  mixed-case emails still sign in.
- Empty or malformed credentials fail inside the credentials provider as an
  ordinary failed sign-in, not an exception, so they never reach the
  configuration error page.

### Sign-in throttling

- The limiter keeps its store, fixed 15-minute windows, hashing of emails,
  IPv6 /64 bucketing, client IP derivation, fail-open behaviour and purge job.
- Its counters change to three:

  | Counter | Key | Counts | Ceiling per window |
  | --- | --- | --- | --- |
  | Email and client | email hash plus client IP bucket | failed attempts | 10 |
  | Email | email hash | failed attempts | 100 |
  | Client | client IP bucket | all attempts | 30 |

- The limit is checked before the password is verified, so a refused attempt
  costs no scrypt. Only a failed verification increments the two email
  counters; the client counter keeps counting every attempt.
- A successful sign-in clears the email-and-client counter.
- The per-email ceiling still allows a determined attacker with many IP
  addresses to lock an account for the rest of a window. That residual is
  accepted: it needs 100 failures per window from distinct clients, and
  without email there is no out-of-band unlock to offer.

### Entity ids

- One entity id contract: a canonical lowercase UUID (8-4-4-4-12 lowercase
  hex, RFC 4122 variant, any version). It is enforced on input wherever a new
  entity id is accepted: entity create (all types) and drawing create with an
  explicit id. All shipped clients (web, CLI, MCP, iOS) already generate
  lowercase UUID v4 ids, so none breaks.
- The id stays client-chosen, preserving idempotent repeat creates.
- Endpoints that address existing entities keep accepting any string id, so
  legacy rows, if any, stay reachable through the API.
- The single entity link builder encodes the id with URI component encoding,
  and every other place that builds an entity URL from an id (app bar frames,
  delete redirects, article blocks, copy link) goes through it or encodes the
  same way.
- The document, drawing and link pages share the same id contract and answer
  not found for ids that fail it, replacing the document page's looser
  pattern.

### Browser security headers

- Headers are set in the Next configuration's headers list, the only place
  headers are set today, so they reach every route including the API (which
  the request proxy's matcher excludes).
- `frame-ancestors 'self'` rather than `'none'` site-wide, because the
  document screenshot route frames same-origin pages. The native sign-in
  page's existing `frame-ancestors 'none'` and `X-Frame-Options: DENY` stay
  and take precedence for that path.
- The report-only policy has no reporting endpoint, to avoid paying for
  function invocations; violations are observed in the browser console during
  local verification. Its source lists cover: same origin; the configured
  Supabase and Vercel Blob storage hosts and the Vercel Blob upload API; the
  Unsplash image host; YouTube thumbnails and the no-cookie embed host;
  Figma embeds; the Twitter widget script and frames; the code-mode runner
  origin; Google font files; OpenRouter for in-browser BYOK; Vercel
  Analytics; and `blob:` and `data:` where the editors use them. HTML blocks
  render in a `srcdoc` frame and inherit the page policy, so the policy must
  allow what the block runtime needs.
- Enforcing the content security policy is a follow-up, decided after a
  release with the report-only header shows no violations for intended
  behaviour.

### Article extractor

- The "not a public address" and "unsupported scheme" refusals become a typed
  refusal error. One mapping turns that error into `BAD_REQUEST` with a short
  message, and every caller of the extractor uses it.
- The extractor's input schema accepts only `http` and `https` URLs.
- The public address check rejects any explicit port other than the scheme's
  web port (80 for `http`, 443 for `https`), and runs for the first request
  and every redirect hop, alongside the existing address checks and address
  pinning.

### Delivery

- Four independent changes, one per area: sign-up and sign-in, entity ids,
  headers, extractor. None depends on another.
- Each is verified locally, including a local Linux production build for the
  headers change; releases follow the Lexidraw cost policy (one prebuilt
  upload, no extra CI or Vercel source builds).

## Testing Decisions

- Tests come first and must fail before each fix. Each test asserts behaviour
  at the highest existing seam, not internal helpers.
- **Sign-up**: the auth router caller, as in the existing auth router tests.
  Covers S1, S2.1, S2.3 and S3.1 against the test database.
- **Credentials sign-in and throttling**: the credentials authorizer, as in
  the existing credentials sign-in and rate-limit tests. Covers S3.2, S4.1,
  S5 through S9. The existing test asserting that the correct password is
  refused past the per-email limit encodes the old design and is rewritten to
  the new counters (S5.1, S7.1).
- **Entity id contract**: the entity router caller, as in the existing entity
  create tests (S10.1 to S10.4), plus the REST route handler, as in the
  existing `/api/v1` route tests, for the 400 shape over HTTP. Existing router
  tests that create entities with readable non-UUID ids are updated to UUIDs;
  tests that insert rows directly keep their ids, which also exercises S13.2.
- **Entity links**: the shared entity link builder, which every caller goes
  through, for S11.1 and S11.2.
- **Pages (S12)**: covered by the shared id contract's router tests; no
  separate page test, since the pages call the same contract.
- **Headers**: a test of the Next configuration's headers list, asserting the
  headers per path (S14.1, S14.2, S15.1, S16.1, S17.1, S17.3). S14.3 and S17.2
  are verified on a local production build in a browser, not by unit test.
- **Extractor**: the public fetch tests for ports and redirects (S19), as in
  the existing public fetch tests, and the REST route handler for the 400
  mapping (S18.1 to S18.3). S18.4 is covered by one test per caller of the
  mapping only where the caller has an existing test harness.

## Out of Scope

- Email verification for password accounts, and holding shares to unverified
  addresses. No email provider exists; accepted as a known limitation, with
  GitHub and Apple sign-ins already verified.
- Hiding whether an email is registered when sharing.
- Proxying remote images in documents.
- Changing the conflict answer for an entity id another user holds, and
  tRPC's distinction between unknown and unauthorized procedures.
- Enforcing the content security policy (follow-up after report-only).
- Rewriting or removing stored entities with non-UUID ids.
- Untested surfaces from the black-box run: the SVG rasterizer, uploads,
  drawing files, narration, the MCP endpoint, the code runner and the render
  worker, DNS rebinding against the extractor, native sign-in code guessing,
  and OAuth linking to a pre-registered email.

## Further Notes

- **Production data left by the test (owner's steps):**
  - Delete the blank user (empty email and name), created around
    2026-11-11 02:24 UTC by an empty sign-up request.
  - Accounts `lexidraw-pentest-a@example.com`, `-b@` and `-c@` stay as
    repro material until these fixes are verified in production, then are
    deleted through account deletion. Account A holds the odd-id entities,
    including ids `""`, `" "`, `../settings`, `__proto__` and a 5,000-character
    id; C holds one empty document. Account deletion removes them.
- Before the page routes reject malformed ids (S12), check production for
  stored drawing and link ids that are not canonical lowercase UUIDs. If any
  exist besides the test rows, keep those pages permissive and record the
  count; links (S11) are fixed either way.
- The HTML block runtime held up: scripts run in an interpreter with no
  `location`, `fetch` or cookies; markup with `src`, event handlers, frames or
  forms is refused. Markdown neutralizes `javascript:`, `data:` and
  `vbscript:` links and renders raw HTML as text.
