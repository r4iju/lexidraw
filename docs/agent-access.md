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
  visible schema. The CLI's `schema` command and any future MCP adapter read
  from it; nothing is hand-maintained twice.
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
- No rate limiting in v1. Add at the context check if ever needed.

## Transports

### REST and OpenAPI

- Generated from the router with `trpc-to-openapi` (tRPC 11, zod 4, Next app
  router adapter). Procedures opt in via `meta.openapi`.
- Paths under `/api/v1/...`. GET inputs must be flat objects; mutations are
  POST/PUT/DELETE. superjson does not apply on this path (plain JSON).
- Document served unauthenticated at `/api/v1/openapi.json`.
- Live: the entity subset below — list/load/create/save/update/delete/search,
  tags, share, and directory listing — plus the four markdown procedures and
  the drawing procedures. Planned: drawing render (#34). Admin, TTS, backups,
  snapshot, image generation, and LLM procedures stay tRPC-only.

#### Paths (live)

| Method | Path                              | Procedure                    |
| ------ | --------------------------------- | ---------------------------- |
| GET    | `/me`                             | `auth.me`                    |
| GET    | `/entities`                       | `entities.list`              |
| POST   | `/entities`                       | `entities.create`            |
| GET    | `/entities/search`                | `entities.search`            |
| GET    | `/entities/{id}`                  | `entities.load`              |
| PUT    | `/entities/{id}`                  | `entities.save`              |
| PATCH  | `/entities/{id}`                  | `entities.update`            |
| DELETE | `/entities/{id}`                  | `entities.delete`            |
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
| GET    | `/drawings/{id}`                  | `drawings.get`               |
| PUT    | `/drawings/{id}`                  | `drawings.put`               |
| POST   | `/drawings`                       | `drawings.create`            |

A directory listing is `GET /entities?parentId={directoryId}`; omitting
`parentId` lists the root. `/entities/search` is registered before
`/entities/{id}` because the adapter matches paths in registration order.
Repeated query parameters (`tagNames`, `entityTypes`) may also be
comma-separated, since a single repetition arrives as a bare string.

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
  - `dir list [<id>|--path P]`,
    `dir create --title T [--dir <id>|--dir-path P]`
  - `search <query>`
  - `drawing get|put|create|render` and `share ...`, still to come
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
- Profiles: `prod` (https://lexidraw.app, default) and `dev`
  (http://localhost:3025), chosen with `--profile` or `LEXIDRAW_PROFILE`;
  `LEXIDRAW_URL` overrides the base URL. Token lookup: `LEXIDRAW_TOKEN`, then
  the macOS keychain (service `cli/lexidraw`, account `<profile>`), like the
  notion wrapper. A token is a credential for one server, so the keychain is
  read and written only when `LEXIDRAW_URL` resolves to the profile's own
  origin, or to a loopback address on `dev`; pointed anywhere else the only
  token source is `LEXIDRAW_TOKEN` and `auth login` refuses to store one.
  `auth login` validates a token against `/me` before storing it; `auth
  status` reports the profile, base URL, token source, and scope.
- Live today: `doc`, `dir`, `search`, `drawing get|put|create`, `auth
  login|status`, `api`, and
  `schema <command>|--list`, whose registry maps a command name to an
  operationId in the cached document.
- Skill: `skills/lexidraw/SKILL.md` in this repo. `bun run skills:install`
  builds and installs the binary, then symlinks `skills/lexidraw` to
  `~/.ai/skills/lexidraw`; it is idempotent, refuses to replace anything
  there that is not already a symlink, and refuses to run from a git
  worktree, whose path would not outlive it.

### MCP (last phase)

- Hosted inside the Next app with `mcp-handler`, stateless streamable HTTP,
  same bearer token auth. Thin client of the same procedures.
- Reuses the built preview widget from `excalidraw/excalidraw-mcp` as an MCP
  Apps resource, with three adapter tools mapping its checkpoint reads and
  writes onto entity load and save. That repo's README says MIT but it has no
  LICENSE file; if that is unacceptable at the time, build a thinner preview
  widget on the SVG export helper instead.

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
- Live today: `drawings.get|put|create` as `GET /drawings/{id}`,
  `PUT /drawings/{id}` (precondition mandatory, as for a markdown replace) and
  `POST /drawings`, and `lexidraw drawing get|put|create`, whose `put` takes
  `--if-unmodified-since <iso|latest>`.
- `drawing render --format svg|png` calls a server-side export using
  `@excalidraw/utils` with the jsdom shim. Pin the package: the `exportToSvg`
  signature changed to `{ data, config }` in 0.1.4 while the docs still show
  the old shape.
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
  no auth; no commits since 2026-03; no LICENSE file.
- Excalidraw+ exposes a paid API and MCP with the same skeleton input and a
  documented scene content schema; useful as a reference only.
