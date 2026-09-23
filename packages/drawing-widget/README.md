# @packages/drawing-widget

The drawing preview widget the MCP endpoint publishes as an MCP Apps resource,
built into one self-contained HTML document.

A host renders an MCP App from the HTML text `resources/read` answers with,
inside a sandbox whose CSP only allows what `_meta.ui.csp` declares. So the
document carries everything: the Excalidraw editor, the `@modelcontextprotocol/ext-apps`
`App` bridge, and the stylesheet, all inlined. The only thing left to fetch is
the editor's fonts, from the one domain the CSP names — see `src/protocol.ts`,
which both halves import so the origin the widget loads from and the origin the
server declares cannot drift apart.

The widget is the real editor rather than a picture of one, so an edit in the
chat is a real Excalidraw edit, saved back through `put_drawing` on the same
MCP connection with the precondition the tool answered. It is written here
against the MIT-licensed `@excalidraw/excalidraw`: `excalidraw/excalidraw-mcp`
publishes a comparable widget but carries no LICENSE file, so none of it is
reused. See docs/agent-access.md.

`bun run build` regenerates `dist/`:

- `dist/protocol.js` — the constants above, as the server reads them.
- `dist/html.js` — the document, about 5 MB. A separate entry point (`./html`)
  because the constants are read on every MCP request and the document only
  when a host asks for the resource.

Mermaid is stubbed out of the bundle: it is 3.5 MB of the 8 MB an untrimmed
editor would cost, on a document the host re-fetches per resource, and
`put_drawing` refuses Mermaid anyway.

`bun test` runs the widget in Chromium against `AppBridge`, the SDK's host
half, and checks the round trip a host would make.
