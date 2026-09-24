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
use deliberately unavailable fixture IDs, so the baseline records their
empty/loading fallback, not third-party content. The video records its error
fallback. Those cases can be extended with local media in #90. The suite
records today's styling defects; later visual tickets update these baselines.

Each render goes through the same `GET /documents/{id}/render` operation as the
CLI and MCP, at 375/768/1280px in light/dark. PNGs retain 1:1 pixels, capped at
6000px high to bound repository growth (currently all six fit without clipping).
The six committed images total **1,372,557 bytes**. Pixelmatch ignores minor
antialiasing changes with a per-pixel threshold of 0.15 and permits at most
0.5% differing pixels. A changed image size always fails. Actual images and
failure diffs go in `.playwright-mcp/document-snapshots/`, never in the baseline
directory unless `--update` was explicitly supplied. Use the same Puppeteer
Chromium and installed fonts when comparing across machines.
