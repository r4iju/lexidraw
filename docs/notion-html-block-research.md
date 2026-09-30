# Notion HTML blocks: evidence and limits

Researched September 30, 2026. This describes Notion, not a security contract for Lexidraw.

## Confirmed by Notion

Notion announced interactive HTML blocks in its July 1, 2026 version 3.6 release. Its examples include calculators, quizzes, and org charts, with agents creating blocks that teammates can use and revise. [Release announcement](https://www.notion.com/releases/2026-07-01)

The current API reference describes HTML blocks as uploaded HTML files rendered interactively in a **sandboxed iframe**. They use the existing `embed` block type: upload an `.html` or `.htm` file with the File Upload API, then attach its ID through `embed.file_upload` when creating or updating a block. The reference identifies this as the same block created by `/html` and Notion MCP. File-backed embeds return a temporary signed URL; consumers must retrieve the block again rather than treat that URL as permanent. [Block reference, Embed and HTML blocks](https://developers.notion.com/reference/block#html-blocks)

## Firsthand reports, not guarantees

Mindful Setups reports testing four widgets on a publicly published Notion page in July 2026. It says anonymous visitors can use the calculator, timers, countdown, and clock. Its tests report working DOM updates, event handlers, timers, animation, and canvas; blocked `fetch`, XHR, and externally loaded scripts, fonts, and images; no direct Notion data access; and state resetting on reload. These are the author's observations, not a documented Notion compatibility or security promise. [Report and linked demo](https://mindfulsetups.com/notion/guides/run-javascript-in-notion-2026)

Matthias Frank's September 27 update likewise describes blocked external calls and no direct workspace access, but reports **local browser persistence**, including whiteboard or counter state surviving refresh. This conflicts with Mindful Setups' persistence report. The difference could reflect code, client, or product changes; the evidence does not resolve it. Do not infer shared or durable storage from either report. [Guide](https://matthiasfrank.de/en/notion-html-blocks/)

A July 12 Reddit user reports HTML blocks displaying poorly on mobile. Another July 15 thread says mobile works but fixed-width layouts can overflow. These anecdotes establish a compatibility concern, not a mobile rendering architecture. The latter thread also contains contradictory claims about database integration, so it is not technical evidence for bidirectional access. [Firsthand mobile complaint](https://www.reddit.com/r/Notion/comments/1uuc8hr/two_years_later_almost_all_my_notion_issues_are/), [discussion](https://www.reddit.com/r/Notion/comments/1uwqcdw/notion_just_quietly_dropped_a_new_update_36/)

## Not established by the sources

- No primary evidence found for QuickJS, a custom interpreter, or a JavaScript engine separate from the iframe. The documented boundary is the sandboxed iframe; it does not identify the underlying engine.
- The reviewed official release and API documentation do not specify iframe sandbox tokens, CSP, network blocking details, storage permissions, resource limits, or a Run/Restart lifecycle. An iframe alone does not prove those properties.
- No official contract found for mobile static snapshots, image revision matching, preview cache authorization, or native browser handoff.
- Public sharing interactivity and network restrictions have useful firsthand reports, but the reviewed primary sources do not define their complete behavior.

## Implications for Lexidraw

Notion supports the product precedent of a self-contained interactive document block, and its API documents a sandboxed iframe boundary. It does **not** supply Lexidraw's isolation or snapshot contract. Lexidraw must independently define source preservation, explicit execution, network policy, resource limits, authorization, and revision matching. Native image previews should remain passive and must not imply that interactions or transient state are synchronized.
