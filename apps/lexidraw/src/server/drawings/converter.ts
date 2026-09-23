import type { SkeletonConverter } from "./normalize";
import { importWithDomShim, withDomShim } from "./dom-shim";

/**
 * The official skeleton converter, running on the server.
 *
 * It comes from `@packages/excalidraw-converter`, which bundles it out of the
 * editor with React stubbed out; that package's README says why. What is left
 * still wants a DOM while its modules evaluate, so the import is dynamic: the
 * shim has to be installed first, and this is the only module that pulls
 * either of them in.
 */
let converter: Promise<SkeletonConverter> | undefined;

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

export function skeletonConverter(): Promise<SkeletonConverter> {
  converter ??= load();
  return converter;
}

async function load(): Promise<SkeletonConverter> {
  const excalidraw = await importWithDomShim(
    () => import("@packages/excalidraw-converter"),
  );
  excalidraw.setCustomTextMetricsProvider({ getLineWidth: measureLine });
  // Ids are the caller's handles: they name bindings and frame children on the
  // way in, and address elements on the way back out.
  return (skeleton) =>
    withDomShim(
      () =>
        excalidraw.convertToExcalidrawElements(skeleton as never, {
          regenerateIds: false,
        }) as unknown as Record<string, unknown>[],
    );
}
