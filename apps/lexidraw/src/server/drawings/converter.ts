import type { DrawingTools } from "./normalize";
import { importWithDomShim, withDomShim } from "./dom-shim";

/**
 * The official skeleton converter and scene restorer, running on the server.
 *
 * They come from `@packages/excalidraw-converter`, which bundles them out of
 * the editor with React stubbed out; that package's README says why. What is
 * left still wants a DOM while its modules evaluate, so the import is dynamic:
 * the shim has to be installed first, and this is the only module that pulls
 * either of them in. Callers pass `drawingTools` itself rather than its
 * result, so a payload that never gets as far as converting never loads it.
 */
let tools: Promise<DrawingTools> | undefined;

/**
 * Character widths without a canvas. Excalidraw asks for a line's width and
 * derives the height itself from the font size and line height, so this is the
 * only measurement that has to be supplied, and a fixed ratio of the font size
 * is close enough for the hand-drawn fonts to lay a label out and size its
 * container.
 */
const WIDTH_PER_CHARACTER = 0.6;

function measureLine(text: string, fontString: string): number {
  const fontSize = Number.parseFloat(fontString);
  return [...text].length * WIDTH_PER_CHARACTER * (fontSize || 20);
}

export function drawingTools(): Promise<DrawingTools> {
  tools ??= load();
  return tools;
}

async function load(): Promise<DrawingTools> {
  const excalidraw = await importWithDomShim(
    () => import("@packages/excalidraw-converter"),
  );
  excalidraw.setCustomTextMetricsProvider({ getLineWidth: measureLine });
  return {
    // Ids are the caller's handles: they name bindings and frame children on
    // the way in, and address elements on the way back out.
    convert: (skeleton) =>
      withDomShim(
        () =>
          excalidraw.convertToExcalidrawElements(skeleton as never, {
            regenerateIds: false,
          }) as unknown as Record<string, unknown>[],
      ),
    // Dimensions are the caller's too: refreshing them would re-measure every
    // text element against fonts this process does not have. Bindings are
    // repaired, because a binding to an element that is not in the payload is
    // what makes the editor throw on open.
    restore: (elements) =>
      withDomShim(
        () =>
          excalidraw.restoreElements(elements as never, null, {
            refreshDimensions: false,
            repairBindings: true,
          }) as unknown as Record<string, unknown>[],
      ),
  };
}
