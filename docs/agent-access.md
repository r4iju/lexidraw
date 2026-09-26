# Agent access: CLI, REST, and MCP for Lexidraw

Status: agreed design, 2026-09-23. Implementation tracked as one GitHub issue per phase.

## Goal

Let AI agents (Claude Code and similar) read and write Lexidraw documents and
drawings from a terminal, the way `gws` exposes Google Workspace, without
loading tool schemas into the agent's context until they are needed.

## Invariants

- **One router, one permission model.** Every transport (tRPC, REST, CLI, MCP)
  resolves to the same procedures and the same `createTRPCContext` check.
- **One public contract.** The OpenAPI document generated from the router is the
  visible schema, and the CLI's `schema` command reads from it. The MCP tools
  publish their own input schemas, reusing the router's where it exports one;
  they are a description of the call, never a second check, because the
  procedure validates its input again.
- **Storage stays canonical.** Documents are Lexical state, drawings are
  Excalidraw elements. Agent-facing formats (markdown, skeleton elements) are
  converted at the boundary, server-side, and validated there.
- **Writes cannot silently clobber.** Destructive document writes require the
  `updatedAt` the caller last read.

## Auth: personal access tokens

- Table `ApiTokens`: id, userId, name, tokenHash, scope (`read` | `write`),
  expiresAt (nullable), lastUsedAt, createdAt, revokedAt.
- Token string is `lxd_` + random; shown once at creation; stored hashed.
- `createTRPCContext` accepts `Authorization: Bearer lxd_...` and resolves it
  to the same session shape as a cookie login. Scope check: queries need
  `read`, mutations need `write`. Admin procedures never accept tokens.
- UI: new `/settings/tokens` page (create, name, expiry, scope, last used,
  revoke). Admin area lists and revokes any user's tokens.
- A token revokes itself with `POST /me/token/revoke`, which is how a device
  signs out. It takes only a token, never a browser session, and revokes the
  one presented and no other. A token of either scope may call it.
- No rate limiting in v1. Add at the context check if ever needed.

### Native sign-in

A native app gets its own token through the system browser, PKCE-style, so
the token never appears in a URL:

1. The app opens `/native-sign-in?redirectUri=…&codeChallenge=…&codeChallengeMethod=S256&deviceName=…`
   in `ASWebAuthenticationSession`. `redirectUri` must be one of
   `NATIVE_SIGN_IN_CALLBACKS` exactly (comma-separated, default
   `lexidraw://auth/callback`); `codeChallenge` is the base64url SHA-256 of a
   43–128 character verifier. A request that fails either is refused on the
   page and never redirected anywhere.
2. Someone not signed in goes through `/signin`, any provider, and comes back.
   The signed-in user then approves in the page's own words; the device name
   is shown only as what the app says, since any app can claim the scheme and
   send any name. The approval is a same-origin POST to
   `/native-sign-in/approve`, and the page refuses to be framed, so no other
   site can approve on the user's behalf; a GET never issues a code.
3. The approval redirects (303) to `redirectUri?code=…`. The code is random,
   stored hashed in `NativeSignInCodes`, bound to the user, the challenge, the
   callback and the device name, and expires after 60 seconds.
4. The app calls `POST /api/v1/native-sign-in/token` with
   `{ code, codeVerifier, redirectUri }` and no token, and gets
   `{ token, name, scope: "write" }` with `Cache-Control: no-store`. The token
   is an ordinary `lxd_` token without expiry, named for the device, listed and
   revoked in Settings like any other.

Every attempt spends the code, a wrong verifier included, and every failure is
the same 400. Presenting a spent code again with its verifier and callback
also revokes the token it bought, since two holders of the verifier means one
of them should not have it; without them a replay revokes nothing, so a code
intercepted on its own cannot sign the device out. A spent code is remembered
for a day for that. This is the one operation the OpenAPI document publishes
without security, and the REST route serves it with an anonymous context: no
cookie session and no token, whatever the request carries.

## Transports

### REST and OpenAPI

- Generated from the router with `trpc-to-openapi` (tRPC 11, zod 4, Next app
  router adapter). Procedures opt in via `meta.openapi`.
- Paths under `/api/v1/...`. GET inputs must be flat objects; mutations are
  POST/PUT/DELETE. superjson does not apply on this path (plain JSON).
- Document served unauthenticated at `/api/v1/openapi.json`.
- Live: the entity subset below — list/load/create/save/update/delete/search,
  tags, share, directory listing, where an entity is, shared with me, the
  trash and a restore — plus the four markdown procedures, a document's PDF,
  the drawing procedures, render included, and a token revoking itself.
  Nothing further is planned. Admin, TTS, backups, snapshot, image
  generation, and LLM procedures stay tRPC-only.

#### Paths (live)

| Method | Path                              | Procedure                    |
| ------ | --------------------------------- | ---------------------------- |
| GET    | `/me`                             | `auth.me`                    |
| POST   | `/me/token/revoke`                | `tokens.revokeCurrent`       |
| GET    | `/me/delete`                      | `auth.deletionConfirmation`  |
| POST   | `/me/delete`                      | `auth.deleteAccount`         |
| GET    | `/entities`                       | `entities.list`              |
| POST   | `/entities`                       | `entities.create`            |
| GET    | `/entities/search`                | `entities.search`            |
| GET    | `/entities/shared`                | `entities.sharedWithMe`      |
| GET    | `/entities/trash`                 | `entities.trash`             |
| GET    | `/entities/{id}`                  | `entities.load`              |
| PUT    | `/entities/{id}`                  | `entities.save`              |
| PATCH  | `/entities/{id}`                  | `entities.update`            |
| DELETE | `/entities/{id}`                  | `entities.delete`            |
| GET    | `/entities/{id}/metadata`         | `entities.getMetadata`       |
| POST   | `/entities/{id}/restore`          | `entities.restore`           |
| GET    | `/entities/{id}/tags`             | `entities.getEntityTags`     |
| PUT    | `/entities/{id}/tags`             | `entities.updateEntityTags`  |
| GET    | `/entities/{id}/shares`           | `entities.getSharedInfo`     |
| POST   | `/entities/{id}/shares`           | `entities.share`             |
| PATCH  | `/entities/{id}/shares/{userId}`  | `entities.changeAccessLevel` |
| DELETE | `/entities/{id}/shares/{userId}`  | `entities.unShare`           |
| GET    | `/tags`                           | `entities.getUserTags`       |
| GET    | `/documents/{id}/markdown`        | `documents.getMarkdown`      |
| PUT    | `/documents/{id}/markdown`        | `documents.replaceMarkdown`  |
| POST   | `/documents/{id}/markdown/append` | `documents.appendMarkdown`   |
| POST   | `/documents/{id}/markdown/insert` | `documents.insertMarkdown`   |
| GET    | `/documents/{id}/render`          | `documents.render`           |
| GET    | `/drawings/{id}`                  | `drawings.get`               |
| PUT    | `/drawings/{id}`                  | `drawings.put`               |
| GET    | `/drawings/{id}/render`           | `drawings.render`            |
| POST   | `/drawings`                       | `drawings.create`            |
| POST   | `/native-sign-in/token`           | `nativeSignIn.exchange`      |

A directory listing is `GET /entities?parentId={directoryId}`; omitting
`parentId` lists the root.
Repeated query parameters (`tagNames`, `entityTypes`) may also be
comma-separated, since a single repetition arrives as a bare string.

`GET /tags` lists a caller's tag only when filtering by it finds something:
the tag has to sit on an entity outside the trash that the caller owns or is
still shared on. A delete only stamps `deletedAt` and an unshare leaves the
former sharer's tag rows, so a restore or a new share brings the tag back. An
archived entity still counts, since `GET /entities?includeArchived=true` lists
it.

`GET /entities/shared` lists what others shared with the caller wherever its
owner keeps it, so a file in a folder the caller was not given is still
reachable; its `parentId` is null when the caller cannot open that folder.
`GET /entities/{id}/metadata` gives the folders above an entity that the
caller may open, from the top down, which is what a breadcrumb shows.

`DELETE /entities/{id}` only stamps `deletedAt`, so `GET /entities/trash` lists
the caller's own entities that carry it, and `POST /entities/{id}/restore`
takes one back out: into the folder it left when its owner may still write
there, or else to the top of Home. Both are the owner's, as the delete is.

`POST /entities` without `elements` starts the entity as the editor opens a
new one: an empty paragraph for a document, no elements for a drawing, and
`{}` for a directory; without a `title` it is "New document", "New drawing"
or "New folder". A url has no empty state, so it needs both. Without a
`parentId` the entity goes at the top of Home, as with a null one.

`POST /me/delete` deletes the caller's account once it is confirmed with the
account's email, or its name when it has none. `GET /me/delete` says which,
so an app asks for what the server will accept; like the delete, it needs a
token that may write.

A `parentId` on a create is resolved before the insert, by `POST /entities` as
by `POST /drawings`: it has to be a directory the caller may write to, and
anything else — a document, a directory of someone else's, nothing at all — is
`NOT_FOUND`, so the foreign key never fails with the statement in its message
and existence stays private.

Who an entity is shared with is its owner's to know and to change. `GET`,
`POST`, `PATCH` and `DELETE` under `/entities/{id}/shares` answer only the
owner; to anyone else, a user it is shared with for editing included, they are
`NOT_FOUND`, as for a stranger. A listing gives the caller's own `access` to
each item (`owner`, `edit` or `read`) rather than naming its owner, and
`GET /entities/{id}` says only `shared`, whether anyone has been given it.
Deleting and sharing take `owner`; renaming, tags, a thumbnail and moving take
`edit`; favorites and the archive are the caller's own and take `read`.

`PATCH` and `DELETE /entities/{id}/shares/{userId}` answer `{ success, message }`
only when they changed or removed a share that was there. A user who holds no
share on the entity is `NOT_FOUND` ("Share not found"), so a revoke that answers
success did revoke something, and repeating it is a 404.

#### Error codes

Every error body is `{ message, code, issues?, data? }`, and `code` is drawn from
the vocabulary in `src/server/api/error-codes.ts`, which the OpenAPI document
publishes as the `ErrorResponse` component:

| Code                     | HTTP |
| ------------------------ | ---- |
| `BAD_REQUEST`            | 400  |
| `PARSE_ERROR`            | 400  |
| `UNAUTHORIZED`           | 401  |
| `FORBIDDEN`              | 403  |
| `NOT_FOUND`              | 404  |
| `METHOD_NOT_SUPPORTED`   | 405  |
| `CONFLICT`               | 409  |
| `PAYLOAD_TOO_LARGE`      | 413  |
| `UNSUPPORTED_MEDIA_TYPE` | 415  |
| `UNPROCESSABLE_CONTENT`  | 422  |
| `TOO_MANY_REQUESTS`      | 429  |
| `INTERNAL_SERVER_ERROR`  | 500  |

Clients branch on `code`, never on `message`. The last five arrive from the
transport before a procedure runs. A 500's message is always the fixed
"Internal server error": the original is logged server-side, never returned.

Reaching an entity you may not touch answers `NOT_FOUND`, not `FORBIDDEN`, so
existence itself stays private. `FORBIDDEN` is reserved for the case where the
caller can already see the entity and only the operation is out of reach, such
as an editor changing public access.

#### Preconditions over REST

`GET /documents/{id}/markdown?format=markdown|raw|json` reads a document:
`markdown` carries the YAML frontmatter, `raw` drops it, `json` returns the
stored Lexical state. Its `updatedAt`, as the ISO string the response carries,
is what the writes take as `ifUnmodifiedSince` in the body — append may omit
it, insert and replace require it, and a body without it is a 400 whose
`issues` name the field. A precondition that no longer matches writes nothing
and answers 409 with `data.currentUpdatedAt` to re-read from. An
`afterHeading` matching several headings answers 400 with `data.candidates`
(`nth`, `blockIndex`, `tag`, `text`); pass one's `nth` to choose. Every write
answers with the `updatedAt` it produced, which is the precondition for the
next one, so a chain of writes never needs a read between them.

### CLI

- Package `apps/cli`, binary `lexidraw`, compiled with `bun build --compile`,
  installed to `~/.ai/bin` by `bun run cli:install`.
- Built on the REST layer. Caches the OpenAPI document at
  `~/.cache/lexidraw/<profile>/<origin>/openapi.json` for 5 minutes, fetched
  unauthenticated; `lexidraw schema <command>` reads from it, refetches once
  if a known command is missing, and `--refresh` bypasses it.
- Nouns and verbs:
  - `doc list [--dir <id>|--dir-path P]`, `doc get <id|--path P>`,
    `doc create --title T [--dir <id>|--dir-path P] [--file f|--text s]`,
    `doc append <id|--path P> (--file f|--text s)`,
    `doc insert ... (--after-heading H [--nth N] | --at-block N)`,
    `doc put ... --replace`, `doc delete <id|--path P>`; `--file -` is stdin
  - `doc render <id|--path P> --format pdf [--paper A4|Letter]
    [--orientation portrait|landscape] [--out <file>]`
  - `dir list [<id>|--path P]`,
    `dir create --title T [--dir <id>|--dir-path P]`
  - `search <query>`
  - `drawing get|put|render|delete <id|--path P>`,
    `drawing create --title T [--dir <id>|--dir-path P] [--file f]`
  - `share ...`, still to come
  - `api <METHOD> <path> [--json ...]` raw escape hatch, only reaches
    procedures that have a REST path
  - `auth login|status`
  - `schema <command>`
- Addressing: entity id, or `--path "Dir/Sub/Title"` walked through directory
  titles from the root, matched exactly first and case-insensitively only if
  nothing matched exactly. Several matches: a read takes the most recently
  updated and says which on stderr, a write fails `AMBIGUOUS_PATH` with the
  candidates as `{ id, title, updatedAt }`. `--nth N` picks one, counting from
  the most recent, among the matches for the last segment of `--path`; on
  `doc insert` that flag belongs to `--after-heading`, so an ambiguous path
  there is addressed by id. A directory the path walked through is never what
  `--nth` picks, so an ambiguous one is answered with an id instead: the
  directory's own for `--dir-path`, the entity's own for `--path`. Nothing
  matched is `NOT_FOUND` with the parent id and the segment that failed. A
  parent directory is `--dir <id>` or `--dir-path "Dir/Sub"`: entity ids are
  free text, so the flag says which form was meant rather than the value's
  shape deciding.
- Titles with a `/` in them: a path splits on `/` unconditionally and has no
  escape, so such a title is only addressable by id. `doc get` prints a
  `path` in its frontmatter joined the same way, which is a display label and
  not always something `--path` can resolve back.
- Writes: `doc put` replaces the whole document and only with `--replace`;
  `insert` and `put` refuse to run without `--if-unmodified-since`, which is
  the `updatedAt` the write expects to find. `--if-unmodified-since latest`
  reads the document first and writes against what it found: check-then-write
  in two calls, still racy, only explicitly so. `doc create` with a body is a
  create then a replace against the revision the create answered, so the
  document starts at the caller's markdown rather than after the empty
  paragraph a new document carries, and reports that write's `updatedAt`.
- Output: JSON default, `--format json|md|raw|table`. `doc get` defaults to
  `md` and prints markdown with frontmatter to stdout, `raw` the same without
  it, `json` the response carrying the stored editor state. `table` pads
  `id`, `title`, `type`, `updatedAt`, and `parentId` for a directory listing.
  `doc list` and `dir list` take `--page-all`, which emits NDJSON, one row per
  line, and refuses an explicit `--format` because it renders its own;
  `entities.list` returns a directory in one answer, so there is nothing to
  page through yet. `search` answers in one page and has no `--page-all`.
- Errors: JSON object on stderr with a stable `code` mirroring the OpenAPI
  error codes, non-zero exit; a usage error exits 2. The server's `data`
  travels with it, so a 409 carries `currentUpdatedAt` and an ambiguous
  `afterHeading` carries `candidates`; the `stack` and the `zodError` that
  repeats `issues` are dropped. A write the server is known to refuse, blank
  markdown above all, is a usage error before any call. `doc create` with a
  body is two calls, so a failure of the second carries `createdId`, the
  empty document the first left behind.
- Profiles: `prod` (https://lexidraw.vercel.app, default) and `dev`
  (http://localhost:3025), chosen with `--profile` or `LEXIDRAW_PROFILE`;
  `LEXIDRAW_URL` overrides the base URL. Token lookup: `LEXIDRAW_TOKEN`, then
  the macOS keychain (service `cli/lexidraw`, account `<profile>`), like the
  notion wrapper. A token is a credential for one server, so the keychain is
  read and written only when `LEXIDRAW_URL` resolves to the profile's own
  origin, or to a loopback address on `dev`; pointed anywhere else the only
  token source is `LEXIDRAW_TOKEN` and `auth login` refuses to store one.
  Whatever the source, no token is sent until the base URL has itself served
  an OpenAPI document titled `Lexidraw API` (cached with the schema, 5
  minutes). The CLI follows no redirects, so a host that answers with a
  redirect, another document, or nothing at all is `NOT_LEXIDRAW_SERVER`
  before the first authenticated call; an unreachable host or a 5xx keeps its
  own code.
  `auth login` validates a token against `/me` before storing it; `auth
  status` reports the profile, base URL, token source, and scope.
- Live today: `doc`, `dir`, `search`, `drawing get|put|create|render|delete`, `auth
  login|status`, `api`, and
  `schema <command>|--list`, whose registry maps a command name to an
  operationId in the cached document. `drawing render` and `doc render` write
  the file to `--out` or to stdout, and refuse to write bytes (a PNG, a PDF)
  to a terminal.
- Skill: `skills/lexidraw/SKILL.md` in this repo. `bun run skills:install`
  builds and installs the binary, then symlinks `skills/lexidraw` to
  `~/.ai/skills/lexidraw`; it is idempotent, refuses to replace anything
  there that is not already a symlink, and refuses to run from a git
  worktree, whose path would not outlive it.

### MCP

- Live at `POST /api/mcp`, hosted inside the Next app with `mcp-handler` over
  `@modelcontextprotocol/server`: stateless streamable HTTP, no sessions, no
  session id, no SSE. POST is the only method the route exports, so Next
  answers the rest with a 405 before any of it runs, and subscriptions are
  capped at zero rather than answered with a stream. Every request builds a
  server, answers one JSON-RPC message, and drops it.
- Auth is the same personal access token as `/api/v1`, through the same
  `createRestContext`, so a missing, unknown, expired, or revoked token is a
  401 carrying the REST error body (`{ message, code: "UNAUTHORIZED" }`)
  before any MCP machinery runs. A token cannot be negotiated over OAuth: the
  endpoint publishes no authorization server metadata, and a client sends the
  header itself.
- Every tool is one call on a server-side tRPC caller built from that context.
  No tool reads the database, so ownership, sharing, and scope are the
  router's answers and the read-scope token that calls a mutating tool gets
  the router's `FORBIDDEN`.

| Tool                    | Procedure                   |
| ----------------------- | --------------------------- |
| `whoami`                | `auth.me`                   |
| `list_entities`         | `entities.list`             |
| `search_entities`       | `entities.search`           |
| `create_document`       | `entities.create`           |
| `get_document_markdown` | `documents.getMarkdown`     |
| `append_markdown`       | `documents.appendMarkdown`  |
| `insert_markdown`       | `documents.insertMarkdown`  |
| `replace_markdown`      | `documents.replaceMarkdown` |
| `get_document_pdf`      | `documents.render`          |
| `get_drawing`           | `drawings.get`              |
| `put_drawing`           | `drawings.put`              |
| `create_drawing`        | `drawings.create`           |

`create_document` is `entities.create` with the empty editor state a new
document carries, so its answer is an id a write can address at once.
`get_document_pdf` answers with the PDF as an embedded resource
(`lexidraw://documents/{id}.pdf`, base64 `blob`) rather than as JSON text.

A tool that succeeded answers with the procedure's output as JSON text. A tool
that failed answers `isError: true` with the body `/api/v1` would have
returned — `{ message, code, issues?, data }`, the same `code` vocabulary — so
an agent branches on `CONFLICT` and reads `data.currentUpdatedAt` or
`data.candidates` the same way over either transport. `data` is always there
with both keys, null when they do not apply, so reading one never means
testing for it first; the `stack`, `zodError`, `httpStatus`, and `path` the
REST adapter also puts on `data` describe this server and are not sent.
The preconditions are REST's: `latest` is a CLI convention and does not exist
server-side, so a write passes the `updatedAt` the previous read or write
answered.

Arguments a tool's own input schema refuses never reach a procedure, so they
come back as the MCP protocol error they are — plain text naming the field —
rather than as an API body. That boundary is not ours to move: a type error
was always going to be answered by the transport. The tool schemas are the
router's, so the two agree on what is refused, and everything a procedure
itself rejects carries the body above.

A read answers into a model's context, which cannot be paged through, so
`get_document_markdown` and `get_drawing` refuse anything over 1 MB of text
with `PAYLOAD_TOO_LARGE` rather than sending half of it. `/api/v1` and the
CLI have no such ceiling; the message says so.

MCP is not part of the OpenAPI document: it is a second transport over the
same procedures, not a REST path.

Connecting Claude Code or Claude Desktop:

```sh
claude mcp add --transport http lexidraw https://lexidraw.vercel.app/api/mcp \
  --header "Authorization: Bearer lxd_..."
```

The header is the only way in: a 401 from this endpoint carries no
`WWW-Authenticate`, so a client cannot discover an authorization server and
negotiate OAuth, and one that tries reports that it needs credentials it
cannot obtain. Mint the token at `/settings/tokens` and pass it as above.

### The drawing preview widget

A drawing created, written, or read through MCP renders in the chat as an MCP
Apps resource: `ui://lexidraw/drawing-preview`, mime type
`text/html;profile=mcp-app`, registered from `src/server/mcp/widget.ts`
alongside the tools and served by the same authenticated handler — an
unauthenticated `resources/read` is the same 401 as everything else.
`create_drawing`, `put_drawing`, and `get_drawing` carry
`_meta.ui.resourceUri` pointing at it (the SDK writes the pre-1.0
`_meta["ui/resourceUri"]` beside it), so a host that renders MCP Apps shows the
editor and a host that does not reads the same JSON it always did.

The widget is **ours**. `excalidraw/excalidraw-mcp` ships a comparable one, but
the repository carries no LICENSE file, so neither its code nor its built
widget is reused — not the checkpoint/save/export adapter tools either. This
one is built on the MIT-licensed `@excalidraw/excalidraw` 0.18.1 the app
already renders with, in `packages/drawing-widget`, which bundles the editor,
the MCP Apps `App` bridge, and the stylesheet into one self-contained HTML
document (~5 MB; Mermaid's 3.5 MB converter is stubbed out, and `put_drawing`
refuses Mermaid anyway). `bun run build` regenerates it into `dist/`, which the
turbo build already does before the app builds, so `next build` and Vercel need
nothing of their own. The document is a second entry point (`/html`) so the
route only loads five megabytes of editor when a host actually asks for the
resource.

Because the widget is the real editor, an edit in it is a real Excalidraw edit
and is saved back through the same `put_drawing` the model calls, over the
host's bridge on the same MCP connection — the widget holds no token and opens
no socket of its own. The precondition travels with it: the `updatedAt` the
tool answered is the `ifUnmodifiedSince` of the widget's next write, and each
write answers with the next one. A `CONFLICT` reloads the drawing and says so;
a `FORBIDDEN` switches the widget read-only, which a read-scope token never
reaches because the payload already says the connection cannot write. After a
save the widget tells the model what changed with `ui/update-model-context`,
since the model read the old elements when the tool answered.

What the widget renders travels in the result's `_meta` under
`app.lexidraw/drawing`, and the payload differs by what the tool's own answer
already carries:

- `create_drawing` and `put_drawing` answer with an id and counts, so their
  payload carries `{ id, title, updatedAt, elements, canWrite }`. The elements
  are the stored drawing, read back after the write, so the widget shows what
  the server made of a skeleton payload rather than the payload. They ride in
  `_meta` rather than in `content` because `content` is what the model reads,
  and a model that just sent those elements has no use for them back. Past the
  1 MB a read may answer with, `elements` is null, `tooLarge` is set, and the
  widget says so instead of drawing half a scene.
- `get_drawing` answers with the whole drawing already, so its payload is
  `{ id, title, updatedAt, canWrite }` and the widget takes the elements out of
  the answer's own JSON. Sending them twice would put one drawing on the wire
  under two separate ceilings.

The payload is built only for a client that advertises MCP Apps, or for one
whose capabilities this endpoint never saw. That second case is the usual one
here and it is why the gate leans that way: the endpoint is stateless, so a
`tools/call` arrives on a server built for that request alone, with no memory of
the `initialize` that named the client's capabilities — and a host given no
drawing renders nothing, while a plain client given a payload merely ignores it.
A client that does negotiate and does not ask for MCP Apps pays nothing: no
scope lookup, and no read-back of the drawing a write just stored.

A host that drops `_meta` costs the widget one `get_drawing` over the bridge and
nothing else. That is also the path a rejected call ends on: the host owns every
call the widget makes and can deny, drop, or time one out, so a refused save
keeps the edit and offers a retry rather than leaving the header mid-save, and a
refused load says so.

`_meta.ui.csp` declares one resource domain, `https://esm.sh`, which is where
the editor's fonts come from (`window.EXCALIDRAW_ASSET_PATH` is pinned to
`https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/`, the same path the
editor falls back to on its own). There are no connect domains: the widget never
talks to the network, only to the host. The editor's chrome is cut to match
rather than the policy widened to fit it — export, save-to-file, open, and the
image tool are off through `UIOptions`, and the library button is hidden: they
reach a file system the sandbox has none of, or fetch subsetted fonts and a wasm
encoder from origins the policy does not name, and images are binary files
`put_drawing` does not carry.

`resources/read` answers about 5 MB, authenticated and uncached, whenever a host
asks for the document. The document itself is built once per instance — it is a
string literal in a module, and the module cache is the memoisation — and
`scripts/build.ts` fails the build if it grows past 6 MB, so its size stays a
decision rather than a drift. The transport answers it as an event stream
(`content-type: text/event-stream`, no `content-length`) rather than one
buffered body, so Vercel's buffered-response limit should not apply; that has
been checked against the route and not against a real deployment or host.

## Documents

- New package `packages/lexical-nodes`: the node classes' serialization
  halves, the markdown transformers, `html-to-text`, `emoji-list`, and an
  exported registered node list, with no `~/components`, `next/*`, CSS, or
  `@packages/lib` barrel imports. Decorator nodes obtain their React component
  lazily (Lexical's own pattern). About ten decorator nodes need the split.
  Browser behaviour is unchanged.
- Also fix the two module-scope `document.createElement` calls in the image
  plugins, and stop the `@packages/lib` barrel from re-exporting env-dependent
  modules (or import `isEqual` directly).
- Server-side headless editor (`@lexical/headless`) behind new procedures:
  - `documents.getMarkdown({ id, format })` → `markdown` is markdown with
    YAML frontmatter (id, title, path, updatedAt, tags); `raw` drops the
    frontmatter; `json` returns the Lexical state. Every node type the editor
    registers has a markdown form or a placeholder, so only a document holding
    an unknown type fails with `UNPROCESSABLE_CONTENT` naming the types;
    malformed stored content fails the same way.
  - `documents.appendMarkdown(id, md)` — never destructive, precondition
    optional. The precondition is the `updatedAt` of the last read; a stale
    one writes nothing and fails with `CONFLICT` plus `data.currentUpdatedAt`
    (ISO) to re-read from. Insert and replace share that error shape, and the
    write itself is a compare-and-set on `updatedAt`, so a save that lands
    between the read and the write is retried against, never clobbered.
  - `documents.insertMarkdown(id, md, { afterHeading | atBlockIndex },
    ifUnmodifiedSince)` — precondition mandatory. `afterHeading` puts the
    blocks directly below a top-level heading whose text matches trimmed,
    whitespace-collapsed, and case-insensitively, inline markup ignored (the
    heading's plain text is compared, so `## Plan **B**` is matched by
    `Plan B`); no match fails naming the top-level headings that do exist.
    Several matches fail with `BAD_REQUEST` listing them on `data.candidates`
    (`nth`, `blockIndex`, `tag`, `text`), and `nth` (1-based, in document
    order) picks one. `atBlockIndex` counts top-level blocks from 0, and the
    block count itself means append.
  - `documents.replaceMarkdown(id, md, ifUnmodifiedSince)` — precondition
    mandatory; CLI exposes it only as `doc put --replace`. The markdown
    becomes the whole document: a placeholder the caller left in puts the
    original node back from the stored revision, one the caller deleted
    deletes that node, and the summary after `#N` is ignored, so an edited or
    dropped summary still resolves. A placeholder for a block has to be a
    top-level line of its own, the way the read wrote it; inside a line of
    text, a list item, a quote, a heading, or a table cell it fails with
    `BAD_REQUEST`, as do an unknown `TYPE#N` (the error lists the placeholders
    the document has) and one used twice. To write *about* a placeholder
    rather than keep it, wrap it in backticks or put it in a fenced block:
    code is literal text and resolves nothing. A mangled placeholder (wrong
    case, a missing space before `-->`) is literal text too, so its node is
    deleted and only `removedPlaceholders` says so. An article's placeholder
    keeps the node and drops the prose below it that the read derived, but
    only when that prose is still character for character what the read
    wrote; edited prose is kept whole, as content of its own, never partly
    dropped. A document holding a node type this version cannot build is
    rejected with `UNPROCESSABLE_CONTENT` rather than rewritten without it.
    The response reports `blocks`, `restoredPlaceholders`, and
    `removedPlaceholders`.
- Blocks without a markdown form (slides, excalidraw, mermaid, chart, poll,
  comment, sticky, ...) render as opaque placeholder comments,
  `<!-- lexidraw:TYPE#N summary -->`, where N is the node's position among
  nodes of that type in document order (node keys are not stable across
  loads) and the summary is a hint for the reader, never parsed: every
  character markdown acts on (`` []()!*_`~$<>| ``) is replaced by a space, so
  a summary can never be re-read as markup. An article is the one node that
  carries both: its placeholder line comes first and the prose it renders as
  follows. On save, a placeholder that still appears re-inserts the original
  node from the stored document; a deleted placeholder deletes the node.

## Drawings

- Write accepts two shapes over one pipeline: raw Excalidraw elements, and the
  skeleton/shorthand format used by `excalidraw/excalidraw-mcp` (`label` on
  shapes and arrows, bindings by id, `frame.children`, `stickynote`). Which
  shape an element is is decided before it is parsed, and it is then validated
  against that shape alone, so nothing reaches the converter that no schema
  checked. Shorthand is expanded with `convertToExcalidrawElements` under jsdom
  plus `setCustomTextMetricsProvider`; everything, converted or raw, then goes
  through Excalidraw's `restoreElements`, so what is stored is what the editor
  would have made of the payload. At most 10,000 elements, under the 4.5 MB
  request body the app is deployed behind.
- `@excalidraw/element` is only published as prereleases of 0.18.0, none
  matching the 0.18.1 editor, so both functions come from
  `@excalidraw/excalidraw`. That entry point is the React editor, and Next's
  `react-server` layer resolves a React without `createContext` on a frozen
  namespace, so it cannot be imported from a route. `packages/excalidraw-converter`
  pre-bundles just those functions with React stubbed out; the route imports
  that package lazily, behind a DOM shim that is installed for the length of a
  conversion and nothing else touches.
- The format is documented in [drawing-format.md](drawing-format.md), which the
  skill embeds so agents that learned the official MCP already know it.
- Live today: `drawings.get|put|create|render` as `GET /drawings/{id}`,
  `PUT /drawings/{id}` (precondition mandatory, as for a markdown replace),
  `GET /drawings/{id}/render` and `POST /drawings`, and `lexidraw drawing
  get|put|create|render`, whose `put` takes `--if-unmodified-since
  <iso|latest>`.
- Render is `exportToSvg` from the same pinned `@excalidraw/excalidraw` 0.18.1
  bundle, under the same DOM shim; `@excalidraw/utils` is not published in a
  version that matches. Its signature has changed across releases, so the call
  shape is written down in `packages/excalidraw-converter/src/index.ts`, where
  a bump has to reckon with it. PNG is that SVG rasterised with `@resvg/resvg-js`,
  pinned, with the editor's own faces checked in under
  `apps/lexidraw/src/server/drawings/fonts` — resvg reads fonts from files and
  does not read WOFF2, so `bun run fonts:sync` decompresses them, records their
  licences, and writes the map from the families the editor names to the ones
  the faces answer to, which half of them disagree on. The image travels in the
  JSON body, base64 for PNG: the OpenAPI adapter answers `application/json` for
  every path, and one generated contract is worth more than a second transport
  for one operation. That body is why a render has a second ceiling, on the
  encoded size, besides the one on pixels. See
  [drawing-format.md](drawing-format.md#rendering).
- Mermaid is not a write format: `mermaid-to-excalidraw` needs a real browser.
  It could become an optional adapter on the render worker later.

## Phases

1. Token auth and `/settings/tokens` page.
2. `packages/lexical-nodes` split and the markdown procedures.
3. REST paths and OpenAPI document.
4. CLI and skill.
5. Drawing normalization and render.
6. MCP with the preview widget.

Phase 1 is useful on its own: curl against tRPC works the moment it lands.

## Research notes

- Headless spike (2026-09-23): markdown round trip works in bun with
  `@lexical/headless` once browser-only imports are stubbed. Importing the 36
  node classes pulled 184 app modules; blockers were CSS imports, `next/font`,
  `@excalidraw/excalidraw` at module scope, two module-scope DOM calls, and
  `@packages/env` validation through the `@packages/lib` barrel.
- Router inputs: 43 of 47 `.input()` schemas are inline in router files; the
  separate schema files and `@packages/types` are pure zod 4 and safe to
  import from a CLI. Wire: `/api/trpc`, superjson, `httpBatchStreamLink`.
- `excalidraw/excalidraw-mcp`: stateless streamable HTTP on Vercel with
  `mcp-handler`; two model-visible tools; normalization happens in the widget;
  no auth; no commits since 2026-03; no LICENSE file. Decided 2026-09-23 (#36):
  with no LICENSE there is no grant to copy from, so nothing of it is reused —
  not the widget, not its build output, and not the three adapter tools around
  its checkpoint read/save/export. The preview widget is written here against
  the MIT-licensed `@excalidraw/excalidraw` package the app already depends on,
  and maps onto `drawings.get`/`drawings.put` directly, which is also what
  makes an edit in the preview a real Excalidraw edit. The skeleton input
  format stays compatible with it: a format an agent already knows is not
  copied code.
- Excalidraw+ exposes a paid API and MCP with the same skeleton input and a
  documented scene content schema; useful as a reference only.
