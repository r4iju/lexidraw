import { excalidraw } from "./converter";
import { withDomShimAsync } from "./dom-shim";
import { excalidrawFontFiles } from "./fonts";
import type { CanonicalElement } from "./skeleton-schema";

export const RENDER_FORMATS = ["svg", "png"] as const;

export type RenderFormat = (typeof RENDER_FORMATS)[number];

export const MAX_RENDER_SCALE = 4;

/**
 * The most pixels a raster is allowed to be, about 16 megapixels, which is
 * 64 MB of RGBA while resvg holds it. A drawing big enough to pass it at 1x
 * is one nobody wants as a single PNG anyway; the SVG has no such limit.
 */
export const MAX_RENDER_PIXELS = 16_000_000;

/** The canvas colour a drawing whose appState never set one is exported on. */
const DEFAULT_BACKGROUND = "#ffffff";

/** The editor's own default, in scene units, around the elements' bounds. */
const EXPORT_PADDING = 10;

/** A render the caller can only fix by asking for a smaller one. */
export class RenderTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderTooLargeError";
  }
}

export type RenderOptions = {
  format: RenderFormat;
  /** Raster pixels per scene unit; ignored by `svg`, which has no pixels. */
  scale?: number;
  /** The drawing's canvas colour, as its appState stored it. */
  background?: string | null;
};

export type DrawingRender =
  | {
      format: "svg";
      contentType: "image/svg+xml";
      width: number;
      height: number;
      svg: string;
    }
  | {
      format: "png";
      contentType: "image/png";
      width: number;
      height: number;
      png: Uint8Array;
    };

/**
 * A drawing as a picture, the way the editor's export dialog draws it.
 *
 * SVG is the editor's own `exportToSvg`, so the geometry is the editor's
 * rather than an imitation of it, and PNG is that SVG rasterised. Text is
 * `<text>` in both: the SVG names the font families and leaves finding them to
 * whatever opens it, while the PNG is drawn with the editor's own faces, which
 * ship with this app.
 *
 * The export is asked not to inline the fonts. It is the only thing in it that
 * would reach the network, and a request that fetches a font is a request that
 * hangs when the network is not there; see `dom-shim.ts` for what else rests
 * on it fetching nothing.
 */
export async function renderDrawing(
  elements: readonly CanonicalElement[],
  options: RenderOptions,
): Promise<DrawingRender> {
  const svg = await toSvg(elements, options.background);
  if (options.format === "svg") return svg;

  const scale = options.scale ?? 1;
  const pixels = svg.width * scale * (svg.height * scale);
  if (pixels > MAX_RENDER_PIXELS) {
    throw new RenderTooLargeError(
      `Rendering this drawing at ${scale}x is ${Math.round(pixels / 1_000_000)} megapixels, over the ${MAX_RENDER_PIXELS / 1_000_000} megapixel limit; ask for a smaller scale or for svg`,
    );
  }
  return toPng(svg.svg, scale);
}

async function toSvg(
  elements: readonly CanonicalElement[],
  background: string | null | undefined,
): Promise<Extract<DrawingRender, { format: "svg" }>> {
  const loaded = await excalidraw();
  const element = await withDomShimAsync(() =>
    loaded.exportToSvg({
      elements,
      files: null,
      appState: {
        exportBackground: true,
        viewBackgroundColor: background ?? DEFAULT_BACKGROUND,
      },
      exportPadding: EXPORT_PADDING,
      skipInliningFonts: true,
    }),
  );
  return {
    format: "svg",
    contentType: "image/svg+xml",
    width: side(element.getAttribute("width")),
    height: side(element.getAttribute("height")),
    svg: element.outerHTML,
  };
}

async function toPng(
  svg: string,
  scale: number,
): Promise<Extract<DrawingRender, { format: "png" }>> {
  // Imported here because the package is a native binding, which Next keeps
  // out of the bundle and a build without it should not have to resolve until
  // a PNG is actually asked for.
  const { Resvg } = await import("@resvg/resvg-js");
  const rendered = new Resvg(svg, {
    font: {
      // Nothing is installed on a serverless filesystem, and a font that
      // happened to be there would make a render depend on the host.
      loadSystemFonts: false,
      fontFiles: excalidrawFontFiles(),
      defaultFontFamily: "Excalifont",
    },
    fitTo: { mode: "zoom", value: scale },
    logLevel: "off",
  }).render();
  return {
    format: "png",
    contentType: "image/png",
    width: rendered.width,
    height: rendered.height,
    png: rendered.asPng(),
  };
}

/** The exported `width`/`height`, which are scene units with `px` on them. */
function side(attribute: string | null): number {
  const parsed = Number.parseFloat(attribute ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
