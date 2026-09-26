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
import { namedTransform } from "./schema-values.js";

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

const parseFigure = objectValue({
  width: optional(
    namedTransform("figureWidth", stringValue(), parseFigureWidth),
  ),
  caption: optional(stringValue()),
});

export const figureState = createState("figure", {
  parse: parseFigure,
  isEqual: (a: Figure, b: Figure) =>
    a.width === b.width && a.caption === b.caption,
});

export function $getFigure(node: LexicalNode): Figure {
  return $getState(node, figureState);
}

export function $setFigure(node: LexicalNode, figure: Figure): void {
  $setState(node, figureState, parseFigure(figure));
}

/** A figure's own size, as it was first drawn: an image's pixels, a diagram's box. */
export type NaturalSize = { width: number; height: number };

/**
 * A size with both sides, each finite and more than nothing, or undefined. A
 * side spelled as a JSON number string counts, as Lexical's numbers read it.
 */
export const parseNaturalSize = namedTransform(
  "naturalSize",
  objectValue({ width: numberValue(), height: numberValue() }),
  (size): NaturalSize | undefined =>
    size.width > 0 &&
    size.height > 0 &&
    Number.isFinite(size.width * size.height)
      ? size
      : undefined,
);

export const naturalSizeState = createState("natural", {
  parse: parseNaturalSize,
  isEqual: (a, b) => a?.width === b?.width && a?.height === b?.height,
});

/**
 * The size a figure was measured at the first time it was drawn, so that it
 * can keep its place before it is drawn again.
 */
export function $getNaturalSize(node: LexicalNode): NaturalSize | undefined {
  return $getState(node, naturalSizeState);
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
  const { width } = $getState(node, figureState, "direct");
  const share = width?.endsWith("%") ? Number.parseInt(width, 10) / 100 : null;
  if (width) element.dataset.figureWidth = share === null ? width : "share";
  else delete element.dataset.figureWidth;
  if (share === null) element.style.removeProperty("--figure-share");
  else element.style.setProperty("--figure-share", String(share));
}
