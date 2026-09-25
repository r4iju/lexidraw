# Document visual baseline

From the repository root, with the dev app on **http://localhost:3025** and
render worker on **http://localhost:4025**:

```sh
bun run test:visual
# After reviewing the captures and intentionally accepting the change:
bun run test:visual --update
```

To run against a second local stack, for example from another worktree, set
`VISUAL_APP_URL=http://localhost:3026` and `VISUAL_FIXTURE_ID` to a document of
its own, so two runs never overwrite the same fixture.

The suite uses the source CLI with `--profile dev`, forces its URL to localhost,
and uses the dev keychain credential. It replaces the dedicated dev fixture
`98683bf7-3f2c-4c60-acd3-a82f24f805ad` on each run. It never runs in `bun run test`
or CI; it refuses to run when `CI` is set.

Edit `fixtures/kitchen-sink.md` first when adding a visual case. Rich blocks
without Markdown forms live in `fixtures/kitchen-sink.blocks.json`, appended
after the Markdown import. The fixture opens with front matter for the
document header (subtitle, cover, properties with a status, mentions, a date
and a link, and a contents list), then headings 1–6, mixed Latin and
Japanese prose, inline formatting, links, nested/ordered/check lists, quotes,
code, aligned tables, equations, the five GitHub callouts, an open
`<details>` collapsible, three `<columns>`, a rule, wide and half-column
figures with captions, two footnotes, image and caption, inline image, Mermaid
(wide, with a caption), chart, poll, drawing (at 75%), slides, article,
page break, video, YouTube, tweet, Figma, sticky note, marked text, comment and
thread. Comments/threads are intentionally invisible outside their panel.
Autocomplete is transient editor state, not a document block.

Images are embedded SVGs and charts/drawings use fixed data. External embeds
use deliberately unavailable fixture IDs; the tweet uses an empty ID so it
stays inert instead of racing a remote widget script. The video uses an embedded
one-second black clip with fixed dimensions; its former empty source raced
between native controls and the error fallback, changing capture height.
The suite records local media and embed fallbacks, not third-party content.
These cases can be extended in #90. Later visual tickets update the remaining
styling defects recorded in these baselines.

Each render goes through the same `GET /documents/{id}/render` operation as the
CLI and MCP, at 375/768/1280px in light/dark. PNGs retain 1:1 pixels, capped at
6000px high to bound repository growth (all six currently reach the cap, so
the end of the fixture is not captured). The six committed images total about
**4.0 MB**. Pixelmatch ignores minor
antialiasing changes with a per-pixel threshold of 0.15 and permits at most
0.5% differing pixels. A changed image size always fails. Actual images and
failure diffs go in `.playwright-mcp/document-snapshots/`, never in the baseline
directory unless `--update` was explicitly supplied. Use the same Puppeteer
Chromium and installed fonts when comparing across machines.

The suite also checks browser-rendered UI colours for text/input/switch contrast,
neutral hover tokens, the UI font and ordered dark surfaces. The fixture pairs
a highlight with a comment underline and uses chart token names in saved data.

Typography checks use `~/.lexidraw-dev-account` for the first sign-in and reuse
an ignored local browser profile in `.playwright-mcp/document-snapshots/browser`.
They verify rendered sizes, the 704px prose / 1024px wide column, heading scale,
CJK emphasis and breaking, print type, container responsiveness, unused font
families, the toolbar size field, and font/language settings after save and
reload. Only localhost is used.

Table cases cover key/value tokens, GFM alignment, a six-column mixed-language
comparison, a three-column table with sentences whose labels together are too
wide for a phone, and the 80% numeric threshold. Browser checks assert content
widths from the text column's edge, the 1024px limit, short tables fitting a
phone while editing and reading, sentences wrapping there while labels, tokens
and Japanese words stay whole (in a heading too; the widest label gives way
between its words), labelled keyboard scroll regions, the pinned
phone column and cell-menu bounds/header toggles. The fixture explicitly clears saved
column widths so every capture exercises a document before manual resizing.

Media cases include a 2000px portrait image, a missing image with alt text,
columns in the text column and written wide, unsized diagrams/video/charts,
voted polls, and empty charts and slides. Browser checks cover 375×812, 768×1024 and 1280×900 in both themes,
plus a narrowed desktop container. They check media bounds and aspect ratios,
centering, theme treatment (photos dimmed a little in dark), half-column
figures filling a phone, footnote markers and the way back after a wrapped
note, placeholders, poll results and print break rules. On touch, property
Edit buttons wait for the header's one Edit properties action.
The suite saves a PDF from the dark editor and a CLI PDF; `pdftotext` (Poppler)
is required to verify the CLI PDF includes its chart and poll results.

Rich-block cases cover separate quotes, long URLs and inline code, multiline
checklist items, plain and numbered code, inline and display equations, and a
single-series chart. The sticky note sits beside the other rich blocks so it
stays within the 6000px baseline cap. The six captures now total about 4 MB;
remaining media fallbacks can extend past the cap and have browser coverage.
Browser checks cover actual inline-math line layout, header accessibility,
number defaults, quote styling, link wrapping, chart legends, collapsible type,
and print wrapping/line markers. The exported PDF must omit the skip link.
