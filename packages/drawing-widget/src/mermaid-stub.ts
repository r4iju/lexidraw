/**
 * Stands in for `@excalidraw/mermaid-to-excalidraw`, which the editor loads
 * from its Mermaid dialog and from a paste that looks like Mermaid.
 *
 * It is a UMD bundle of mermaid and cytoscape, and it is 3.5 MB of the 8 MB a
 * bundled editor would otherwise cost — on a document the host re-fetches per
 * resource, for a dialog that has no place in a preview. Mermaid is not a
 * drawing write format here either: `put_drawing` refuses it, and the app is
 * where a drawing gets built from Mermaid.
 */
const unavailable = () => {
  throw new Error(
    "Mermaid is not available in the preview; open the drawing in Lexidraw.",
  );
};

export const parseMermaidToExcalidraw = unavailable;
export const graphToExcalidraw = unavailable;
export default { parseMermaidToExcalidraw, graphToExcalidraw };
