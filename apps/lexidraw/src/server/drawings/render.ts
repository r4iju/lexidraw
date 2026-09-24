import { excalidraw } from "./converter";
import { withDomShimAsync } from "./dom-shim";
import { excalidrawFontFiles } from "./fonts";
import { EXCALIDRAW_FONT_FAMILIES } from "./fonts.generated";
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

/**
 * The most encoded image a render may answer with. The image comes back
 * inside a JSON body, and the deployment caps a response at 4.5 MB, so a
 * render that is under the pixel limit can still be one the platform truncates
 * into an unparseable body: a detailed drawing compresses badly, and base64
 * adds a third on top. Refusing here turns that into an error the caller can
 * read and act on.
 */
export const MAX_RENDER_BYTES = 3_000_000;

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

/** A thumbnail's size in CSS pixels, the one every card lays out. */
export const THUMBNAIL_SIZE = { width: 640, height: 480 } as const;

/** Raster pixels per CSS pixel, for screens that have two. */
const THUMBNAIL_SCALE = 2;

/** CSS pixels kept clear around the drawing. */
const THUMBNAIL_MARGIN = 24;

/** How the editor turns its canvas dark, and so how a dark thumbnail does. */
const DARK_CANVAS_FILTER = "invert(93%) hue-rotate(180deg)";

const COLOUR = /^(#[0-9a-f]{3,8}|[a-z]+)$/i;

/**
 * The drawing as its thumbnail: the whole scene, fitted inside a canvas of
 * {@link THUMBNAIL_SIZE} and centred on it, drawn in the editor's light or
 * dark canvas. A drawing smaller than the canvas is shown at its own size, as
 * the editor's zoom to fit does, rather than blown up.
 */
export async function renderDrawingThumbnail(
  elements: readonly CanonicalElement[],
  options: { theme: "light" | "dark"; background?: string | null },
): Promise<{ width: number; height: number; png: Uint8Array }> {
  const canvas =
    options.background && COLOUR.test(options.background)
      ? options.background
      : DEFAULT_BACKGROUND;
  const drawing = await toSvg(elements, canvas);
  const { width, height } = THUMBNAIL_SIZE;
  const zoom = Math.min(
    1,
    (width - 2 * THUMBNAIL_MARGIN) / (drawing.width || 1),
    (height - 2 * THUMBNAIL_MARGIN) / (drawing.height || 1),
  );
  const [w, h] = [drawing.width * zoom, drawing.height * zoom];
  const placed = drawing.svg.replace(
    /^<svg\b([^>]*)>/,
    (_, attributes: string) =>
      `<svg${attributes.replace(/\s(?:width|height|x|y)="[^"]*"/g, "")} x="${(width - w) / 2}" y="${(height - h) / 2}" width="${w}" height="${h}">`,
  );
  const filter =
    options.theme === "dark" ? ` filter="${DARK_CANVAS_FILTER}"` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g${filter}><rect width="${width}" height="${height}" fill="${canvas}"/>${placed}</g></svg>`;
  const {
    png,
    width: pixelWidth,
    height: pixelHeight,
  } = await toPng(svg, THUMBNAIL_SCALE);
  return { width: pixelWidth, height: pixelHeight, png };
}

async function toSvg(
  elements: readonly CanonicalElement[],
  background: string | null | undefined,
): Promise<Extract<DrawingRender, { format: "svg" }>> {
  const loaded = await excalidraw();
  const element = await withDomShimAsync(() =>
    loaded.exportToSvg({
      // The editor deletes an element by marking it, and keeps the marked
      // element in the scene; the export takes only the live ones and does not
      // check, so a deleted element left in would draw nothing and still
      // stretch the canvas out to wherever it was sitting.
      elements: elements.filter(isVisible),
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

function isVisible(
  element: CanonicalElement,
): element is CanonicalElement & { isDeleted?: false } {
  return element.isDeleted !== true;
}

async function toPng(
  svg: string,
  scale: number,
): Promise<Extract<DrawingRender, { format: "png" }>> {
  // Imported here because the package is a native binding, which Next keeps
  // out of the bundle and a build without it should not have to resolve until
  // a PNG is actually asked for.
  const { Resvg } = await import("@resvg/resvg-js");
  const rendered = new Resvg(withBundledFamilies(svg), {
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

const FONT_FAMILY = /font-family="([^"]*)"/g;

/**
 * The same SVG, naming the bundled faces instead of the editor's families.
 *
 * Half of the faces the editor ships call themselves something else in their
 * own name tables — `Cascadia` is `Cascadia Code`, `Nunito` is
 * `Nunito ExtraLight` — and `Helvetica` is a local font it ships nothing for.
 * A rasteriser matches on those internal names, so without this every one of
 * them falls back silently and the text comes out in the wrong face.
 *
 * Only the copy handed to the rasteriser is rewritten. The SVG a caller gets
 * is the export's own, naming the families the drawing actually uses, so it
 * still picks up the real fonts wherever they are installed.
 */
function withBundledFamilies(svg: string): string {
  return svg.replace(FONT_FAMILY, (_, families: string) => {
    const bundled = families
      .split(",")
      .map((family) => family.trim())
      // An unmapped name is left alone rather than dropped: it is one of the
      // emoji or CJK fallbacks, which no bundled face answers to and the
      // rasteriser simply passes over.
      .map((family) => EXCALIDRAW_FONT_FAMILIES[family] ?? family);
    return `font-family="${bundled.join(", ")}"`;
  });
}

/** The exported `width`/`height`, which are scene units with `px` on them. */
function side(attribute: string | null): number {
  const parsed = Number.parseFloat(attribute ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}
