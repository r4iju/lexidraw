import { exportToSvg as exportToSvgUntyped } from "@excalidraw/excalidraw";

export {
  convertToExcalidrawElements,
  restoreElements,
  setCustomTextMetricsProvider,
} from "@excalidraw/excalidraw";
export type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

/**
 * The 0.18.1 call shape of `exportToSvg`, written down because nothing else
 * checks it: the editor re-exports the function from `@excalidraw/utils`, a
 * package it does not depend on, so its declaration does not resolve and the
 * import arrives as `any`. The signature has changed across releases — it
 * takes one options object here, and returns the element rather than a string
 * — so this is the version's shape as `dist/types/utils/export.d.ts` in the
 * pinned package declares it, and a bump that changes it has to change this.
 *
 * `skipInliningFonts` is `true` or absent, never `false`, upstream as well as
 * here: leaving it out is what makes the export subset and embed the fonts,
 * which it does by fetching them.
 */
export type ExportToSvgOptions = {
  elements: readonly unknown[];
  files: Record<string, unknown> | null;
  appState?: Record<string, unknown>;
  exportPadding?: number;
  renderEmbeddables?: boolean;
  skipInliningFonts?: true;
  reuseImages?: boolean;
};

export const exportToSvg = exportToSvgUntyped as (
  options: ExportToSvgOptions,
) => Promise<SVGSVGElement>;
