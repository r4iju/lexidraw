import type { DrawingTools } from "./normalize";
import { withDomShim, withDomShimAsync } from "./dom-shim";

/**
 * The editor's own element code, running on the server: the skeleton
 * converter and scene restorer a write goes through, and the SVG export a
 * render goes through.
 *
 * They come from `@packages/excalidraw-converter`, which bundles them out of
 * the editor with React stubbed out; that package's README says why. What is
 * left still wants a DOM while its modules evaluate, so the import is dynamic:
 * the shim has to be installed first, and this is the only module that pulls
 * it in. Callers take it from here rather than importing it themselves, so a
 * request that never gets as far as needing it never loads it.
 */
type Excalidraw = typeof import("@packages/excalidraw-converter");

let bundle: Promise<Excalidraw> | undefined;

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

export function excalidraw(): Promise<Excalidraw> {
  bundle ??= load();
  return bundle;
}

async function load(): Promise<Excalidraw> {
  const loaded = await withDomShimAsync(
    () => import("@packages/excalidraw-converter"),
  );
  loaded.setCustomTextMetricsProvider({ getLineWidth: measureLine });
  return loaded;
}

export async function drawingTools(): Promise<DrawingTools> {
  const loaded = await excalidraw();
  return {
    // Ids are the caller's handles: they name bindings and frame children on
    // the way in, and address elements on the way back out.
    convert: (skeleton) =>
      withDomShim(
        () =>
          loaded.convertToExcalidrawElements(skeleton as never, {
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
          loaded.restoreElements(elements as never, null, {
            refreshDimensions: false,
            repairBindings: true,
          }) as unknown as Record<string, unknown>[],
      ),
  };
}
