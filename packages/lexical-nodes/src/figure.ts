import {
  $getState,
  $setState,
  createState,
  type LexicalNode,
  numberValue,
  objectValue,
  optional,
  stringValue,
} from "lexical";
import { namedTransform, shapedAs, storedValue } from "./schema-values.js";

/**
 * How wide a figure sits: the text column when unset, the wide column, the
 * full page width, or a share of the text column.
 */
export type FigureWidth = "wide" | "full" | `${number}%`;

export type Figure = {
  width?: FigureWidth;
  /**
   * The caption of a figure without a caption editor of its own. Images and
   * video keep theirs in the nested editor they always had. An empty string
   * is a caption being written.
   */
  caption?: string;
};

const PERCENT = /^(\d{1,3})%$/;

/** A width as markdown or a control names it, or undefined for the column. */
export function parseFigureWidth(value: unknown): FigureWidth | undefined {
  if (value === "wide" || value === "full") return value;
  const percent = typeof value === "string" ? PERCENT.exec(value) : null;
  const share = Number(percent?.[1]);
  return share >= 10 && share < 100 ? `${share}%` : undefined;
}

/** What a stored figure says, read as `$getFigure` reads it. */
function parseFigure(value: unknown): Figure {
  if (typeof value !== "object" || value === null) return {};
  const figure: Figure = {};
  const width = parseFigureWidth(Reflect.get(value, "width"));
  if (width) figure.width = width;
  const caption: unknown = Reflect.get(value, "caption");
  if (typeof caption === "string") figure.caption = caption;
  return figure;
}

/**
 * A figure's width and caption. The state holds what was stored as it was
 * stored, and is read through {@link $getFigure}: a document is saved as it
 * was loaded until someone changes the figure.
 */
export const figureState = createState("figure", {
  parse: shapedAs(
    objectValue({
      width: optional(
        namedTransform("figureWidth", stringValue(), parseFigureWidth),
      ),
      caption: optional(stringValue()),
    }),
    storedValue<unknown>(),
  ),
});

export function $getFigure(node: LexicalNode): Figure {
  return parseFigure($getState(node, figureState));
}

export function $setFigure(node: LexicalNode, figure: Figure): void {
  const parsed = parseFigure(figure);
  const empty = parsed.width === undefined && parsed.caption === undefined;
  $setState(node, figureState, empty ? undefined : parsed);
}

/** A figure's own size, as it was first drawn: an image's pixels, a diagram's box. */
export type NaturalSize = { width: number; height: number };

/** A size with both sides numbers, each finite and more than nothing, or undefined. */
export function parseNaturalSize(value: unknown): NaturalSize | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const width: unknown = Reflect.get(value, "width");
  const height: unknown = Reflect.get(value, "height");
  return typeof width === "number" &&
    typeof height === "number" &&
    width > 0 &&
    height > 0 &&
    Number.isFinite(width * height)
    ? { width, height }
    : undefined;
}

/** Like {@link figureState}, the size as stored, read through {@link $getNaturalSize}. */
export const naturalSizeState = createState("natural", {
  parse: shapedAs(
    namedTransform(
      "naturalSize",
      objectValue({ width: numberValue(), height: numberValue() }),
      parseNaturalSize,
    ),
    storedValue<unknown>(),
  ),
});

/**
 * The size a figure was measured at the first time it was drawn, so that it
 * can keep its place before it is drawn again.
 */
export function $getNaturalSize(node: LexicalNode): NaturalSize | undefined {
  return parseNaturalSize($getState(node, naturalSizeState));
}

export function $setNaturalSize(node: LexicalNode, size: NaturalSize): void {
  $setState(node, naturalSizeState, parseNaturalSize(size));
}

/**
 * Marks a figure's element with its width for the stylesheet: `wide`,
 * `full`, or `share` with the share in `--figure-share`. Called from
 * `createDOM` and `updateDOM`, where the node is read as it is.
 */
export function figureDOM(node: LexicalNode, element: HTMLElement): void {
  const { width } = parseFigure($getState(node, figureState, "direct"));
  const share = width?.endsWith("%") ? Number.parseInt(width, 10) / 100 : null;
  if (width) element.dataset.figureWidth = share === null ? width : "share";
  else delete element.dataset.figureWidth;
  if (share === null) element.style.removeProperty("--figure-share");
  else element.style.setProperty("--figure-share", String(share));
}
