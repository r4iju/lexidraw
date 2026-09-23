/**
 * Renders the drawing payload on argv and writes the result to the file named
 * after it, printing what the render reported along with the browser globals
 * defined before and after it.
 *
 * Run by `render.test.ts` in a child process, for the same reason
 * `normalize-drawing.ts` is: the render puts a DOM on the globals while it
 * runs, and only a process that does nothing else can say whether any of it
 * stayed behind.
 *
 * Usage: render-drawing.ts <elements json> <out file> <svg|png> [scale]
 */
import { normalizeDrawingElements } from "~/server/drawings/normalize";
import { drawingTools } from "~/server/drawings/converter";
import { renderDrawing, type RenderFormat } from "~/server/drawings/render";
import { DrawingElements } from "~/server/drawings/skeleton-schema";

const WATCHED = [
  "window",
  "self",
  "top",
  "document",
  "navigator",
  "location",
  "Element",
  "HTMLElement",
  "FontFace",
];
const defined = () => WATCHED.filter((name) => name in globalThis);

const [payload, out, format, scale] = process.argv.slice(2);
const before = defined();
const elements = await normalizeDrawingElements(
  DrawingElements.parse(JSON.parse(payload as string)),
  drawingTools,
);
const rendered = await renderDrawing(elements, {
  format: format as RenderFormat,
  scale: scale === undefined ? undefined : Number(scale),
});
await Bun.write(
  out as string,
  rendered.format === "svg" ? rendered.svg : rendered.png,
);
process.stdout.write(
  JSON.stringify({
    format: rendered.format,
    contentType: rendered.contentType,
    width: rendered.width,
    height: rendered.height,
    before,
    after: defined(),
  }),
);
