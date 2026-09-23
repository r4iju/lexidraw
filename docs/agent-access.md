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
- v1 exposes: entities list/load/create/save/update/delete/search, tags,
  share, directory listing, the markdown procedures, drawing normalize and
  render. Admin, TTS, backups, snapshot, image generation, LLM procedures stay
  tRPC-only.

### CLI

- Package `apps/cli`, binary `lexidraw`, compiled with `bun build --compile`,
  installed to `~/.ai/bin` by a repo script.
- Built on the REST layer. Caches the OpenAPI document per profile with a
  short TTL; `lexidraw schema <command>` reads from it.
- Nouns and verbs:
  - `doc list|get|create|append|insert|put|delete`
  - `drawing get|put|create|render`
  - `dir list|create`
  - `search <query>`
  - `share ...`
  - `api <METHOD> <path> [--json ...]` raw escape hatch, only reaches
    procedures that have a REST path
  - `auth login|status`
  - `schema <command>`
- Addressing: entity id, or `--path "Dir/Sub/Title"` resolved through
  directory titles. Ambiguous matches on writes fail with candidates as JSON;
  reads pick the most recently updated with a warning on stderr. `--nth`
  disambiguates.
- Output: JSON default, `--format json|md|table`. Markdown commands print raw
  markdown to stdout. `--page-all` emits NDJSON.
- Errors: JSON object on stderr with a stable `code` mirroring the OpenAPI
  error codes, non-zero exit.
- Profiles: `prod` (https://lexidraw.app, default) and `dev` (localhost).
  Token lookup: env var, then macOS keychain, like the notion wrapper.
- Skill: `skills/lexidraw/SKILL.md` in this repo, symlinked into
  `~/.ai/skills` by `bun run skills:install`.

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
    mandatory; CLI exposes it only as `doc put --replace`.
- Blocks without a markdown form (slides, excalidraw, mermaid, chart, poll,
  comment, sticky, ...) render as opaque placeholder comments,
  `<!-- lexidraw:TYPE#N summary -->`, where N is the node's position among
  nodes of that type in document order (node keys are not stable across
  loads) and the summary is a hint for the reader, never parsed. On save, a
  placeholder that still appears re-inserts the original node from the stored
  document; a deleted placeholder deletes the node.

## Drawings

- Write accepts two shapes over one pipeline: raw Excalidraw elements, and the
  skeleton/shorthand format used by `excalidraw/excalidraw-mcp` (`label` on
  shapes and arrows, bindings by id, `frame.children`, `stickynote`).
  Normalized server-side with `convertToExcalidrawElements` from
  `@excalidraw/element` under jsdom plus `setCustomTextMetricsProvider`, then
  validated and stored as canonical elements.
- The skill embeds the upstream `read_me` cheat sheet so agents that learned
  the official MCP already know the format.
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
