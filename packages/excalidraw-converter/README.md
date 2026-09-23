# @packages/excalidraw-converter

Excalidraw's own `convertToExcalidrawElements`, `restoreElements` and
`exportToSvg`, bundled so they can run on a server.

`@excalidraw/excalidraw` is the editor: a React package that reads `window`,
`document` and a canvas while its modules evaluate. `@excalidraw/element`, the
pure half, does not carry the converter, and is only published as prereleases
of 0.18.0 that do not match the 0.18.1 editor this repo renders with.

So the converter is bundled here instead, with React replaced by a stub. That
matters for more than size: a Next route handler runs in the `react-server`
layer, where `react` resolves to a build with no `createContext` and a frozen
module namespace, and the editor's modules do not evaluate there. With React
bundled away, `dist/index.js` is plain JavaScript that any runtime loads.

The stub is never called. Nothing renders through React; the converter is
element maths and the SVG export builds DOM nodes itself. The DOM they expect
is supplied by the caller — see
`apps/lexidraw/src/server/drawings/dom-shim.ts`.

`exportToSvg` arrives untyped, because the editor re-exports it from
`@excalidraw/utils`, which it does not depend on. `src/index.ts` writes down
the 0.18.1 call shape instead; the signature has changed across releases, so a
version bump has to reckon with that type.

`bun run build` regenerates `dist/`.
