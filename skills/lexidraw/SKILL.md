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
bun run skills:install       # from a clone of the lexidraw repo: builds and
                             # installs ~/.ai/bin/lexidraw and links this skill
lexidraw auth login --token lxd_...   # validated against /me before it is stored;
                                      # without --token it reads the token from
                                      # stdin, interactively when stdin is a tty
lexidraw auth status         # profile, base URL, token source, scope
```

Tokens are minted at `/settings#api-tokens` in the app, with scope `read` or
`write`, and shown once.

Profiles: `prod` (https://lexidraw.vercel.app, the default) and `dev`
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
#    id, title, path, updatedAt and tags, then the header (see "Front matter").
#    The title is shown above the content, so the body does not repeat it.
lexidraw doc get --path "Projects/Release notes"
# ---
# id: "0b0f2c1e-..."
# title: "Release notes"
# path: "Projects/Release notes"
# updatedAt: "2026-09-23T10:11:12.000Z"
# tags: []
# ---
#
# ## 0.4.1
# ...

# 3. Append. New trailing blocks at the end of the document, never
#    destructive, so the precondition is optional.
lexidraw doc append --path "Projects/Release notes" --text '## 0.4.2

- Faster export.'

# 4. Insert immediately after a heading block, before the section's existing
#    body (the new bullet lands above "- Faster export."). Precondition
#    mandatory; `latest` re-reads first (two calls, still racy, only
#    explicitly so). Use the updatedAt from the read when the read is fresh.
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
lexidraw doc create [--title T] [--dir <id>|--dir-path P] [--file f|--text s]
lexidraw doc insert <id|--path P> (--file f|--text s) --at-block N --if-unmodified-since W
lexidraw doc render <id|--path P> [--format png|pdf] [--width 1280] \
  [--theme light|dark] [--paper A4|Letter] [--orientation portrait|landscape] [--out <file>]
lexidraw doc delete <id|--path P>
lexidraw dir list [<id>|--path P] [--format json|table] [--page-all]
lexidraw dir create --title T [--dir <id>|--dir-path P]
```

`doc create` with a body starts the document at that markdown rather than after
the empty paragraph a new document carries. Without `--title`, the body names
the document: its front matter `title`, or else a leading `# Heading`, which
then leaves the content. The answer's `title` is the one it got.

`doc render` defaults to a PNG of the full document, at 1280px in light mode.
Widths are integer pixels from 1 to 4096. Choose `--width 375 --theme dark --out phone.png` to check the mobile view.
It needs only read access. PNGs are limited to 16 megapixels, and both formats
to 3 MB base64; reduce the PNG width if the render is too large. Bytes are
refused on a terminal, so pass `--out` or redirect stdout. REST uses
`GET /documents/{id}/render?format=png&width=375&theme=dark`; MCP exposes the
same operation as `get_document_image` (PNG) and `get_document_pdf` (PDF).

`--format pdf` prints in light colours, with the title at the top of every
page but the first, "n / total" at the bottom right, and bookmarks from the
headings.
`--paper A4|Letter` and `--orientation portrait|landscape` apply to PDF;
`--width` and `--theme` apply to PNG. Document creates, editor saves and
markdown append/insert/replace, plus drawing creates and puts, queue fresh
dashboard thumbnails asynchronously.

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
among the matches for the last segment of `--path` (also on `dir list`); an
ambiguous directory segment, or a `--dir-path` segment, has to be addressed by
id. On `doc insert` that flag belongs to `--after-heading`, so an ambiguous
path there has to be addressed by id too.

`--after-heading` matches a top-level heading trimmed, whitespace-collapsed,
case-insensitively, inline markup ignored (`## Plan **B**` is matched by
`Plan B`), and inserts immediately after that heading block. Several matching
headings fail `BAD_REQUEST` with `data.candidates` carrying `nth`,
`blockIndex`, `tag`, and `text`; pass that `nth`, which counts matching
headings **in document order**, not by recency as on paths. No match is a
`BAD_REQUEST` without candidates. `--at-block N` counts top-level blocks from
0, and the block count appends.

`doc list` lists documents only; `dir list` lists every entity type in a
directory, drawings included.

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

## Writing markdown

What each construct becomes. A read writes the same form back, so a document
read, edited and replaced keeps its structure.

| markdown | becomes |
| --- | --- |
| `#` to `######` | headings; the title is the document's own (see below), so start sections at `##` |
| `**bold**`, `*italic*`, `~~strike~~`, `==highlight==`, `` `code` `` | inline formatting |
| `-`, `1.`, `- [ ]` / `- [x]` | bulleted, numbered and check lists; indent to nest |
| `> text` | a quote |
| `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` | a callout of that kind, tinted in its colour; any text after the marker is its title, and every following `>` line is its body, which can hold any blocks |
| `<details>` + `<summary>Title</summary>` … `</details>` | a collapsible section; `<details open>` starts open |
| `<columns>` + one `<column>` … `</column>` each … `</columns>` | side-by-side columns of equal width in the text column, stacked on phones; `<columns wide>` uses the wide column |
| a GFM table (`\| a \| b \|` + `\| --- \| ---: \|`) | a table as wide as its content, up to the text column: sentences in cells wrap to fit it, and only a table whose labels cannot fit grows wider, into the wide column; short labels, numbers and dates wrap only between words, once a phone has no room left; alignment colons are kept |
| ```` ```lang ```` fence | a code block with syntax highlighting |
| `$x^2$` | inline math: the `$` hug the formula, no space inside and no digit after |
| `$$x^2$$` on its own line, or `$$` lines around it | a block equation |
| `![Caption](src)` on its own line | an image with that caption; `![Caption](src){alt="Text for screen readers"}` adds alt text |
| `![alt](src "Caption")` | an image whose alt and caption differ; inside a sentence the brackets are only alt |
| `{.wide}`, `{.full}`, `{width=50%}` after an image | the wide column, the page width, or a share of the text column (10–99%, the whole column on a phone); the text column is the default, at most 28rem tall |
| `text[^1]` and `[^1]: The note.` | a footnote; notes are numbered in the order their markers appear and gather at the end |
| `---` | a horizontal rule |
| `<tweet id="…" />` on its own line | an embedded post |

- Leave a blank line between blocks, and inside `<details>` and `<column>`
  around their content.
- `$5 and $10` stays prose. Write `\$` only when a `$` would otherwise hug
  text, as in `\$x$`.
- Tables of five or more columns scroll sideways on phones; prefer fewer
  columns, or a list. Japanese in an English document breaks between
  phrases, so it needs no markup.
- Obsidian (`> [!info]`, `> [!danger]` …) and Docusaurus (`:::tip[Title]` …
  `:::`) callouts import as the nearest of the five kinds, keeping the word as
  the title. A read always writes the GitHub form.

Every write answers with `notes`: the places it read the markdown one way when
another was possible (an alias that became a callout, an image attribute that
was not kept, a footnote marker without its note, a wide table), and the
front matter fields it applied. Read them, and change the next write if the
interpretation was not what you meant. A markdown read reports `losses` (the
CLI prints them to stderr as `note:` lines): what the document holds that
markdown cannot say, such as uneven column widths, hand-set table widths,
image sizes and text colours. A replace keeps column and table widths while
the block keeps its position and column count, and drops the rest.

### Title and front matter

The document's title shows above the content and is not a heading. On a
replace, or a write into an empty document, a leading `# X` becomes the title
when the document is untitled, and is dropped when it repeats the title;
anywhere else it stays a heading.

A write reads a leading `---` YAML block as fields, never as content, and a
read writes the same block back, so reading and replacing changes nothing:

```yaml
---
title: Trip plan            # the document's title
tags: [travel, kyoto]       # your tags on it
subtitle: Three days, one base
cover: https://example.com/maples.jpg
cover_alt: Maples at Tofuku-ji
cover_focus: 50% 30%        # the point the crop keeps in view
lang: en                    # the document's language
toc: true                   # a contents list of the ## and ### headings
properties:                 # shown under the title; any other key lands here too
  status: in progress       # drawn as a pill
  owner: "@ada"             # @name is a mention
  due: 2026-11-14           # an ISO date shows as a local date
  source: https://example.com
---
```

`id`, `path` and `updatedAt` are recognised and ignored. A key the block
leaves out is cleared from the header; without a block, the header is kept.

A sample document that uses the common constructs:

````markdown
---
title: "Trip plan: Kyoto in autumn"
toc: true
properties:
  status: draft
---

Three days, one base, no car. Costs are in yen; $5 and $10 stay prose.

> [!TIP] Book early
> Hotels near Kyoto Station fill up by **late September**.

## Day by day

<columns>
<column>

### Day 1

- Fushimi Inari at dawn
- Tofuku-ji for the maples

</column>
<column>

### Day 2

1. Arashiyama bamboo grove
2. Tenryu-ji garden

</column>
</columns>

| Item | Cost (¥) |
| --- | ---: |
| Rail pass | 29,650 |
| Hotel, 3 nights | 45,000 |

> [!WARNING]
> Temples close at 16:30 in November.

<details>
<summary>Packing list</summary>

- [ ] Walking shoes
- [x] Rain jacket

</details>

The walking budget is $d = v \cdot t$ for each day:

$$d = 4\,\text{km/h} \times 6\,\text{h}$$
````

## Output and escape hatches

Output is JSON on stdout unless a format says otherwise. `doc get` takes
`--format md|raw|json`: `md` (the default) is markdown with frontmatter, `raw`
drops the frontmatter, `json` is the stored editor state. Listings take
`--format json|table`; `--page-all` (`doc list`, `dir list`) emits NDJSON, one
row per line, and cannot be combined with `--format`.

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
| `UNAUTHORIZED` | the token is unknown, revoked, or expired | mint a new one at `/settings#api-tokens` |
| `FORBIDDEN` | a `read`-scope token tried to write, or the entity is shared without edit rights | use a `write`-scope token; ask the owner for edit access |
| `UNKNOWN_COMMAND` | no such command for `schema` | `lexidraw schema --list` |
| `AMBIGUOUS_PATH` | a write path matched several entities | pick one from `candidates` with `--nth N` or its id |
| `NOT_FOUND` | no match for a segment, or `--nth` past the end; from a delete, an entity shared with you rather than yours | check the path; the error names the segment and parent. Only the owner can delete |
| `BAD_REQUEST` | invalid input: an ambiguous or unmatched `--after-heading`, `--at-block` out of range, a misplaced placeholder, a malformed drawing element (`issues` names the path) | with `data.candidates`, pass its `nth`; otherwise fix the input the message names |
| `CONFLICT` | the document moved since the read | re-read from `data.currentUpdatedAt` and redo the edit |
| `UNPROCESSABLE_CONTENT` | the document holds a node type this version cannot read or build | do not rewrite it; report the types the error names |
| `PAYLOAD_TOO_LARGE` | the request body is over the 4.5 MB limit | send less, or split the write |
| `TOO_MANY_REQUESTS` | rate limited | wait and retry |
| `NOT_LEXIDRAW_SERVER` | the base URL does not serve the Lexidraw API itself (another site, or a redirect); no token was sent | fix `LEXIDRAW_URL` or `--profile`; after a redirect, use the address the message names |
| `REDIRECT` | a request was redirected, which the CLI does not follow | point `LEXIDRAW_URL` at the server itself; a redirect of the API document comes back as `NOT_LEXIDRAW_SERVER` with the base URL to use |
| `NETWORK` | the server could not be reached | check the base URL and that the server is up |
| `BAD_RESPONSE` | the server answered with something the CLI could not parse | retry with `--refresh`; report it if it persists |
| `INTERNAL`, `INTERNAL_SERVER_ERROR` | a bug on either side, details masked | report it with the command that failed |

## Drawings

```bash
lexidraw drawing get <id|--path P>   # { id, title, elements, appState, updatedAt }
lexidraw drawing create --title T [--dir <id>|--dir-path P] [--file f|-]
lexidraw drawing put <id|--path P> --file <f|-> --if-unmodified-since <iso|latest>
lexidraw drawing delete <id|--path P>
```

Paths and `--nth` work as under Addressing; a drawing's `--path` matches
drawings only. `delete`, like `doc delete`, moves the entity to the trash
and only its owner can do it.

`put` replaces the whole element set and `--file` must hold a bare JSON
array, so a round trip edits the `elements` of the read and carries its
`updatedAt`:

```bash
lexidraw drawing get <id> > d.json
jq '.elements' d.json > elements.json          # edit this
lexidraw drawing put <id> --file elements.json \
  --if-unmodified-since "$(jq -r .updatedAt d.json)"
```

The array mixes two shapes, both described in `drawing-format.md` next to
this file (read it before writing a drawing that is more than boxes and
arrows):

- **Shorthand**, the format of the official Excalidraw MCP: a shape with
  `label: { text, fontSize? }` gets a centred text element; an arrow with
  `start: { id }` / `end: { id }` is bound to those shapes; a `frame` with
  `children: [ids]` groups them (frames take no geometry, only `children` and
  an optional `name`); `stickynote` is a filled box with text. Give every
  shorthand element an `id` so bindings and later edits can name it. Shapes
  need `x` and `y`, take `width` and `height`, and look comes from
  `backgroundColor`, `fillStyle`, `strokeColor`, `strokeWidth`, and
  `roundness: { "type": 3 }` for rounded corners.
- **Canonical** elements, exactly as `drawing get` returns them. They are
  validated and normalised by Excalidraw's restore, not stored byte for byte.

Mermaid is rejected by name; at most 10,000 elements; keep the body under
Vercel's 4.5 MB limit.

```bash
lexidraw drawing render <id|--path P> [--format svg|png] [--scale 1-4] [--out <file>]
```

`render` writes the image to `--out`, or to stdout (SVG as text; PNG bytes
are refused on a terminal, so pass `--out`). SVG names the font families
rather than embedding them; PNG is rasterised server-side with the bundled
fonts, `--scale` multiplies the pixel size. Deleted elements are left out and
only `viewBackgroundColor` is honoured, so a dark-mode drawing still renders
light. A raster over 16 megapixels is refused, and so is one that encodes to
over 3 MB; lower `--scale` or ask for `svg`.
