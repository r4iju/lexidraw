# Document visual baseline

From the repository root, with the dev app on **http://localhost:3025** and
render worker on **http://localhost:4025**:

```sh
bun run test:visual
# After reviewing the captures and intentionally accepting the change:
bun run test:visual --update
```

The suite uses the source CLI with `--profile dev`, forces its URL to localhost,
and uses the dev keychain credential. It replaces the dedicated dev fixture
`98683bf7-3f2c-4c60-acd3-a82f24f805ad` on each run. It never runs in `bun run test`
or CI; it refuses to run when `CI` is set.

Edit `fixtures/kitchen-sink.md` first when adding a visual case. Rich blocks
without Markdown forms live in `fixtures/kitchen-sink.blocks.json`, appended
after the Markdown import. The fixture contains headings 1–6, mixed Latin and
Japanese prose, inline formatting, links, nested/ordered/check lists, quotes,
code, aligned tables, equations, a rule, image and caption, inline image,
columns, an open collapsible, Mermaid, chart, poll, drawing, slides, article,
page break, video, YouTube, tweet, Figma, sticky note, marked text, comment and
thread. Comments/threads are intentionally invisible outside their panel.
Autocomplete is transient editor state, not a document block. Callouts and
Markdown details/summary are explicitly TODO #91; use the JSON collapsible
until that ticket lands.

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
6000px high to bound repository growth (currently all six fit without clipping).
The six committed images total about **1.8 MB**. Pixelmatch ignores minor
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
reload. Only localhost:3025 is used.

Table cases cover key/value tokens, GFM alignment, a six-column mixed-language
comparison and the 80% numeric threshold. Browser checks assert intrinsic
widths, the 1024px limit, labelled keyboard scroll regions, the pinned phone
column and cell-menu bounds/header toggles. The fixture explicitly clears saved
column widths so every capture exercises a document before manual resizing.
