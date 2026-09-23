/**
 * Stands in for `@excalidraw/mermaid-to-excalidraw`, which the editor loads
 * only from its Mermaid dialog. It is a UMD bundle of mermaid and cytoscape
 * whose `define([...])` branches a bundler consuming `dist/` cannot resolve,
 * and Mermaid is not a write format here anyway.
 */
const unavailable = () => {
  throw new Error("Mermaid conversion needs a browser");
};

export const parseMermaidToExcalidraw = unavailable;
export const graphToExcalidraw = unavailable;
export default { parseMermaidToExcalidraw, graphToExcalidraw };
