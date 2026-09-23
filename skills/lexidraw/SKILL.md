---
name: lexidraw
description: Use for reading, creating, or editing Lexidraw documents, directories, and drawings from the terminal.
---

# Lexidraw

The `lexidraw` binary is Lexidraw from the terminal: documents, directories,
search, and drawings, over the same REST layer the app uses.

## When to use

- A Lexidraw link, document title, or directory path is named.
- Notes, specs, or drawings have to be read out of Lexidraw or written into it.
- Anything a browser tab would be opened for: reading a document, appending a
  section, replacing a document, creating a directory.

Everything below is the live surface. `lexidraw --help` is the same text,
`lexidraw schema <command>` is the request and response schema for one command.

## Setup

```bash
bun run cli:install          # from the lexidraw repo; installs ~/.ai/bin/lexidraw
lexidraw auth login          # paste a lxd_... token, validated before it is stored
lexidraw auth status         # profile, base URL, token source, scope
```

Tokens are minted at `/settings/tokens` in the app, with scope `read` or
`write`, and shown once.

Profiles: `prod` (https://lexidraw.app, the default) and `dev`
(http://localhost:3025). Choose one with `--profile` or `LEXIDRAW_PROFILE`.

- `LEXIDRAW_URL` overrides the base URL of the chosen profile.
- `LEXIDRAW_TOKEN` is a token for this call, taking precedence over the
  keychain.
- The keychain (service `cli/lexidraw`, account `<profile>`) is read and
  written **only** when the base URL is the profile's own origin, or a loopback
  address on `dev`. Pointed at any other host, the only token source is
  `LEXIDRAW_TOKEN` and `auth login` refuses to store one — a token is a
  credential for one server.

## Read, then write

Reads are free. Writes that overwrite anything need the `updatedAt` they expect
to find, so read first and carry that value into the write. A worked example:

```bash
# 1. Find it. Either search, or address it by path.
lexidraw search "Release notes" --format table

# 2. Read it. `doc get` defaults to markdown with YAML frontmatter carrying
#    id, title, path, updatedAt, and tags.
lexidraw doc get --path "Projects/Release notes"
# ---
# id: "0b0f2c1e-..."
# title: "Release notes"
# path: "/Projects/Release notes"
# updatedAt: "2026-09-23T10:11:12.000Z"
# tags: []
# ---
#
# # Release notes
# ...

# 3. Append. Never destructive, so the precondition is optional.
lexidraw doc append --path "Projects/Release notes" --text '## 0.4.2

- Faster export.'

# 4. Insert under a heading. Precondition mandatory; `latest` re-reads first
#    (two calls, still racy, only explicitly so). Use the updatedAt from the
#    read when the read is fresh.
lexidraw doc insert --path "Projects/Release notes" \
  --after-heading "0.4.2" --text "- Fixed the PDF margins." \
  --if-unmodified-since latest

# 5. Replace the whole document. `--replace` is the confirmation that nothing
#    is kept, and the precondition is the updatedAt step 2 read.
lexidraw doc put --path "Projects/Release notes" --replace \
  --file rewritten.md --if-unmodified-since 2026-09-23T10:11:12.000Z
```

Every write answers with the `updatedAt` it produced, which is the precondition
for the next one, so a chain of writes needs no read in between. `--file -`
reads stdin, so a heredoc works anywhere `--file` does.

The rest of the surface:

```bash
lexidraw doc list [--dir <id>|--dir-path P] [--format json|table] [--page-all]
lexidraw doc create --title T [--dir <id>|--dir-path P] [--file f|--text s]
lexidraw doc insert <id|--path P> (--file f|--text s) --at-block N --if-unmodified-since W
lexidraw doc delete <id|--path P>
lexidraw dir list [<id>|--path P] [--format json|table] [--page-all]
lexidraw dir create --title T [--dir <id>|--dir-path P]
```

`doc create` with a body starts the document at that markdown rather than after
the empty paragraph a new document carries.

## Addressing

An entity is its id, or `--path "Dir/Sub/Title"` walked through directory
titles from the root. Exact title match first, case-insensitive only if
nothing matched exactly. A parent directory is `--dir <id>` or
`--dir-path "Dir/Sub"`; the flag says which form it is, the value's shape is
never guessed. A path splits on `/` with no escape, so a title containing `/`
is addressed by id, and the `path` in a `doc get` frontmatter is a display
label rather than something to feed back to `--path`.

Several matches: a **read** takes the most recently updated and says which on
stderr; a **write** fails `AMBIGUOUS_PATH` with the candidates as
`{ id, title, updatedAt }`. `--nth N` picks one, counting from the most recent,
among the matches for the last segment of `--path`; an ambiguous directory
segment, or a `--dir-path` segment, has to be addressed by id. On `doc insert`
that flag belongs to `--after-heading`, so an ambiguous path there has to be
addressed by id too.

`--after-heading` matches a top-level heading trimmed, whitespace-collapsed,
case-insensitively, inline markup ignored (`## Plan **B**` is matched by
`Plan B`). Several matching headings fail `BAD_REQUEST` with `data.candidates`
carrying `nth`, `blockIndex`, `tag`, and `text`; pass that `nth`.
`--at-block N` counts top-level blocks from 0, and the block count appends.

## Placeholders

Blocks with no markdown form (slides, excalidraw, mermaid, chart, poll, ...)
read back as one opaque line:

```
<!-- lexidraw:excalidraw#1 architecture sketch -->
```

- Keep the line to keep the block; delete the line to delete the block.
- Never edit it. The summary after `#N` is ignored, so an edited summary still
  resolves, but a mangled comment is literal text and its node is deleted.
- It has to stay a top-level line of its own. Inside a paragraph, list item,
  quote, heading, or table cell it fails `BAD_REQUEST`, as does an unknown
  `TYPE#N` or one used twice.
- To write *about* a placeholder, wrap it in backticks or a fenced block: code
  is literal text and resolves nothing.
- An article carries both: the placeholder line, then the prose derived from
  it. Keeping the placeholder drops that derived prose, but only while the
  prose is still character for character what the read wrote.

Placeholders matter on `doc put --replace`, which rebuilds the document from
the markdown given. The response reports `blocks`, `restoredPlaceholders`, and
`removedPlaceholders`.

## Output and escape hatches

Output is JSON on stdout. `doc get` takes `--format md|raw|json`: `md` (the
default) is markdown with frontmatter, `raw` drops the frontmatter, `json` is
the stored editor state. Listings take `--format json|table`, and `--page-all`
emits NDJSON, one row per line.

```bash
lexidraw schema doc insert       # request and response schema of one command
lexidraw schema --list           # every command with a schema
lexidraw api GET /entities/search --query query=notes
lexidraw api POST /documents/<id>/markdown/append --json '{"markdown":"hi"}'
```

`api` is the raw call against `/api/v1`, for anything the verbs do not cover.
`--refresh` ignores the cached OpenAPI document (cached 5 minutes).

## Errors

Errors are a JSON object on stderr with a stable `code` and a non-zero exit;
usage errors exit 2.

| code | meaning | what to do |
| --- | --- | --- |
| `USAGE` | the arguments are wrong | read the message; it names the missing flag |
| `NO_TOKEN` | no token for this profile | `lexidraw auth login`, or set `LEXIDRAW_TOKEN` |
| `KEYCHAIN_UNAVAILABLE` | `security` could not be run or read | set `LEXIDRAW_TOKEN` instead |
| `UNAUTHORIZED` | the token is unknown, revoked, or expired | mint a new one at `/settings/tokens` |
| `FORBIDDEN` | a `read`-scope token tried to write | use a `write`-scope token |
| `UNKNOWN_COMMAND` | no such command for `schema` | `lexidraw schema --list` |
| `AMBIGUOUS_PATH` | a write path matched several entities | pick one from `candidates` with `--nth N` or its id |
| `NOT_FOUND` | no match for a segment, or `--nth` past the end | check the path; the error names the segment and parent |
| `BAD_REQUEST` | ambiguous `--after-heading`, or a misplaced placeholder | pass the `nth` from `data.candidates`; move the placeholder to its own line |
| `CONFLICT` | the document moved since the read | re-read from `data.currentUpdatedAt` and redo the edit |
| `UNPROCESSABLE_CONTENT` | the document holds a node type this version cannot read or build | do not rewrite it; report the types the error names |

## Drawings

```bash
lexidraw drawing get <id>                        # canonical Excalidraw elements
lexidraw drawing create --title T [--file f|-] [--parent <dir id>]
lexidraw drawing put <id> --file <f|-> --if-unmodified-since <iso|latest>
```

`put` replaces the whole element set, so read first and send everything back.
The body is a JSON array mixing two shapes, both described in
`docs/drawing-format.md` in the lexidraw repo (read it before writing a
drawing that is more than boxes and arrows):

- **Shorthand**, the format of the official Excalidraw MCP: a shape with
  `label: { text }` gets a centred text element; an arrow with
  `start: { id }` / `end: { id }` is bound to those shapes; a `frame` with
  `children: [ids]` groups them; `stickynote` is a filled box with text.
  Give every shorthand element an `id` so bindings and later edits can name
  it. Geometry is `x`, `y`, `width`, `height`; look comes from
  `backgroundColor`, `fillStyle`, `strokeColor`, `strokeWidth`, `roundness`,
  `fontSize`, `fontFamily`.
- **Canonical** elements, exactly as `drawing get` returns them. They are
  validated and normalised by Excalidraw's restore, not stored byte for byte.

Mermaid is rejected by name; at most 10,000 elements; keep the body under
Vercel's 4.5 MB limit. Rendering to SVG or PNG lands with issue #34.
