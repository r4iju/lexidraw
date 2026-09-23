# @packages/excalidraw-converter

Excalidraw's own `convertToExcalidrawElements`, bundled so it can run on a
server.

`@excalidraw/excalidraw` is the editor: a React package that reads `window`,
`document` and a canvas while its modules evaluate. `@excalidraw/element`, the
pure half, does not carry the converter, and is only published as prereleases
of 0.18.0 that do not match the 0.18.1 editor this repo renders with.

So the converter is bundled here instead, with React replaced by a stub. That
matters for more than size: a Next route handler runs in the `react-server`
layer, where `react` resolves to a build with no `createContext` and a frozen
module namespace, and the editor's modules do not evaluate there. With React
bundled away, `dist/index.js` is plain JavaScript that any runtime loads.

The stub is never called. Nothing renders; the converter is element maths. The
DOM the bundle still expects is supplied by the caller — see
`apps/lexidraw/src/server/drawings/dom-shim.ts`.

`bun run build` regenerates `dist/`.
