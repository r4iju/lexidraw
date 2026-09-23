/**
 * Normalizes the drawing payload on argv and prints the canonical elements,
 * along with the browser globals defined before and after the conversion.
 *
 * Run by `converter.test.ts` in a child process: the converter puts a DOM on
 * the globals for the length of a conversion, and this reports whether any of
 * it stayed behind, which a test in the same process as everything else could
 * not tell apart from a DOM some other test installed.
 */
import { drawingTools } from "~/server/drawings/converter";
import { normalizeDrawingElements } from "~/server/drawings/normalize";
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

const before = defined();
const input = DrawingElements.parse(JSON.parse(process.argv[2] as string));
const elements = await normalizeDrawingElements(input, drawingTools);
process.stdout.write(JSON.stringify({ elements, before, after: defined() }));
