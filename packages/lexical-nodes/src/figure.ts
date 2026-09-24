import {
  $getState,
  $setState,
  createState,
  type LexicalNode,
  NODE_STATE_KEY,
  type SerializedLexicalNode,
} from "lexical";

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

function parseFigure(value: unknown): Figure {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const figure: Figure = {};
  const width = parseFigureWidth(raw.width);
  if (width) figure.width = width;
  if (typeof raw.caption === "string") figure.caption = raw.caption;
  return figure;
}

export const figureState = createState("figure", {
  parse: parseFigure,
  isEqual: (a, b) => a.width === b.width && a.caption === b.caption,
});

export function $getFigure(node: LexicalNode): Figure {
  return $getState(node, figureState);
}

export function $setFigure(node: LexicalNode, figure: Figure): void {
  $setState(node, figureState, parseFigure(figure));
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

/**
 * The node state a figure node's own `exportJSON` has to carry: those nodes
 * write their fields by hand, and the base class is what writes the state.
 */
export function nodeStateJSON(
  json: SerializedLexicalNode,
): Pick<SerializedLexicalNode, typeof NODE_STATE_KEY> {
  const state = json[NODE_STATE_KEY];
  return state ? { [NODE_STATE_KEY]: state } : {};
}

/** Restores what {@link nodeStateJSON} wrote onto a freshly imported node. */
export function $importNodeState<T extends LexicalNode>(
  node: T,
  json: SerializedLexicalNode,
): T {
  return json[NODE_STATE_KEY] ? node.updateFromJSON(json) : node;
}
