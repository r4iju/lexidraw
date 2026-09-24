import type {
  ElementTransformer,
  MultilineElementTransformer,
  TextMatchTransformer,
} from "@lexical/markdown";
import { $dfs } from "@lexical/utils";
import { $createParagraphNode, $isTextNode, type LexicalNode } from "lexical";
import {
  $getFigure,
  $setFigure,
  type FigureWidth,
  parseFigureWidth,
} from "./figure.js";
import { htmlToPlainText } from "./html-to-text.js";
import { reportMarkdownNote } from "./markdown-notes.js";
import { ArticleNode } from "./nodes/ArticleNode.js";
import { ChartNode } from "./nodes/ChartNode.js";
import { CommentNode } from "./nodes/CommentNode.js";
import { EquationNode } from "./nodes/EquationNode.js";
import { ExcalidrawNode } from "./nodes/ExcalidrawNode.js";
import { FigmaNode } from "./nodes/FigmaNode.js";
import { ImageNode } from "./nodes/ImageNode.js";
import { InlineImageNode } from "./nodes/InlineImageNode.js";
import { MermaidNode } from "./nodes/MermaidNode.js";
import { PageBreakNode } from "./nodes/PageBreakNode.js";
import { PollNode } from "./nodes/PollNode.js";
import { SlideNode } from "./nodes/SlideNode.js";
import { StickyNode } from "./nodes/StickyNode.js";
import { ThreadNode } from "./nodes/ThreadNode.js";
import { TweetNode } from "./nodes/TweetNode.js";
import { VideoNode } from "./nodes/VideoNode.js";
import { YouTubeNode } from "./nodes/YouTubeNode.js";

/**
 * `![alt](src "title"){attributes}`. An image alone in its paragraph is a
 * figure, captioned by its title or else by its alt text, as Pandoc reads
 * it; `{alt="…"}` then gives the alt text separately. The attributes also
 * carry the figure width: `{.wide}`, `{.full}` or `{width=50%}`.
 */
const IMAGE_PATTERN =
  /!\[([^[\]]*)\]\(\s*(<[^>]*>|[^\s()]+)(?:\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'))?\s*\)(?:\{([^{}\n]*)\})?/;

const ATTRIBUTE = /\.([\w-]+)|([\w-]+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))|(\S+)/g;

const unescapeQuoted = (text: string) => text.replace(/\\(.)/g, "$1");
const escapeQuoted = (text: string) => text.replace(/["\\]/g, "\\$&");

type ImageAttributes = { alt?: string; width?: FigureWidth };

function readImageAttributes(source: string, src: string): ImageAttributes {
  const attributes: ImageAttributes = {};
  const ignored: string[] = [];
  for (const [token, className, key, quoted, bare] of source.matchAll(
    ATTRIBUTE,
  )) {
    const value = quoted !== undefined ? unescapeQuoted(quoted) : bare;
    const width = parseFigureWidth(className ?? (key === "width" && value));
    if (width) attributes.width = width;
    else if (key === "alt" && value !== undefined) attributes.alt = value;
    else ignored.push(token);
  }
  if (ignored.length > 0) {
    reportMarkdownNote(
      `The image ${src} attribute${ignored.length === 1 ? "" : "s"} ${ignored.join(" ")} ${ignored.length === 1 ? "is" : "are"} not kept; an image takes alt, .wide, .full and width=N%`,
    );
  }
  return attributes;
}

const $isAlone = (node: LexicalNode) =>
  !node.getPreviousSibling() && !node.getNextSibling();

function imageAttributesMarkdown({ alt, width }: ImageAttributes): string {
  const parts = [
    ...(alt !== undefined ? [`alt="${escapeQuoted(alt)}"`] : []),
    ...(width === "wide" || width === "full"
      ? [`.${width}`]
      : width
        ? [`width=${width}`]
        : []),
  ];
  return parts.length > 0 ? `{${parts.join(" ")}}` : "";
}

export const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!ImageNode.$isImageNode(node)) {
      return null;
    }
    const alt = node.getAltText();
    const caption = node.getCaptionText();
    const { width } = $getFigure(node);
    const alone = $isAlone(node);
    // Alone, the bracketed text is the caption, so alt text that differs
    // from it, or stands without one, needs an attribute of its own.
    const figure = alone && caption === "";
    const bracketed = figure ? "" : alt;
    const title = caption && !(alone && caption === alt) ? caption : "";
    return `![${bracketed}](${node.getSrc()}${title ? ` "${escapeQuoted(title)}"` : ""})${imageAttributesMarkdown(
      { alt: figure && alt ? alt : undefined, width },
    )}`;
  },
  importRegExp: IMAGE_PATTERN,
  regExp: new RegExp(`${IMAGE_PATTERN.source}$`),
  replace: (textNode, match) => {
    const [, bracketed = "", rawSrc = "", doubleQuoted, singleQuoted, attrs] =
      match;
    const src = rawSrc.replace(/^<(.*)>$/, "$1");
    const title =
      doubleQuoted !== undefined ? unescapeQuoted(doubleQuoted) : singleQuoted;
    const attributes = attrs ? readImageAttributes(attrs, src) : {};
    const alone = $isAlone(textNode);
    const caption = title || (alone ? bracketed : "");
    const imageNode = ImageNode.$createImageNode({
      altText: attributes.alt ?? bracketed,
      maxWidth: 800,
      src,
    });
    if (caption) imageNode.setCaptionText(caption);
    if (attributes.width) $setFigure(imageNode, { width: attributes.width });
    textNode.replace(imageNode);
  },
  trigger: ")",
  type: "text-match",
};

/**
 * `$x$` is inline math only when the delimiters hug the formula: no space
 * inside either edge, and no digit right after the closing one. That is the
 * Pandoc rule, and it is what keeps "$5 and $10" prose. `$$` is never an
 * inline delimiter; it marks a block equation.
 */
const INLINE_EQUATION = /(?<![\\$])\$(?![\s$])([^$\n]*?[^\s\\$])\$(?![\d$])/;

export const EQUATION: TextMatchTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (!EquationNode.$isEquationNode(node)) {
      return null;
    }
    const equation = node.getEquation();
    if (node.__inline) return `$${equation}$`;
    return equation.includes("\n") ? `$$\n${equation}\n$$` : `$$${equation}$$`;
  },
  importRegExp: INLINE_EQUATION,
  regExp: new RegExp(`${INLINE_EQUATION.source}$`),
  replace: (textNode, match) => {
    const [, equation] = match;
    const equationNode = EquationNode.$createEquationNode(equation, true);
    textNode.replace(equationNode);
  },
  trigger: "$",
  type: "text-match",
};

/**
 * Plain text that would read as inline math, such as an escaped `\$x$` or
 * a `$` typed in the editor, is written with its `$` escaped, so the next
 * import keeps it text. It has no markdown of its own to import.
 */
export const LITERAL_DOLLAR: TextMatchTransformer = {
  dependencies: [],
  export: (node, _exportChildren, exportFormat) => {
    if (!$isTextNode(node) || node.hasFormat("code")) return null;
    const text = node.getTextContent();
    const math = new RegExp(INLINE_EQUATION.source, "g");
    if (!math.test(text)) return null;
    return exportFormat(node, text).replace(math, (found) => `\\${found}`);
  },
  regExp: /(?!)/,
  type: "text-match",
};

/** `$$x$$` alone on its line: a block equation, in a paragraph of its own. */
export const BLOCK_EQUATION: ElementTransformer = {
  dependencies: [EquationNode],
  export: () => null,
  regExp: /^\$\$(?!\$)(.*?[^$])\$\$\s*$/,
  replace: (parentNode, children, match, isImport) => {
    if (!isImport) return false;
    const [, equation = ""] = match;
    const node = EquationNode.$createEquationNode(equation.trim(), false);
    const [textNode] = children;
    if (textNode) textNode.replace(node);
    else parentNode.append(node);
  },
  type: "element",
};

/** `$$` on a line of its own opens a block equation that runs to the next. */
export const BLOCK_EQUATION_FENCE: MultilineElementTransformer = {
  dependencies: [EquationNode],
  regExpEnd: /^\s*\$\$\s*$/,
  regExpStart: /^\s*\$\$\s*$/,
  replace: (rootNode, _children, _start, end, linesInBetween, isImport) => {
    if (!isImport || !end || !linesInBetween) return false;
    const equation = linesInBetween.join("\n").replace(/^\n+|\n+$/g, "");
    rootNode.append(
      $createParagraphNode().append(
        EquationNode.$createEquationNode(equation, false),
      ),
    );
  },
  type: "multiline-element",
};

export const TWEET: ElementTransformer = {
  dependencies: [TweetNode],
  export: (node) => {
    if (!TweetNode.$isTweetNode(node)) {
      return null;
    }

    return `<tweet id="${node.getId()}" />`;
  },
  regExp: /<tweet id="([^"]+?)"\s?\/>\s?$/,
  replace: (parentNode, children, match) => {
    const [, id] = match;
    if (!id) return false;
    const tweetNode = TweetNode.$createTweetNode(id);
    // The importer cut the line as if the tag opened it; what came before
    // the tag is prose, and stays a paragraph above the tweet.
    const { input = "", index = 0 } = match as RegExpMatchArray;
    const before = input.slice(0, index).trimEnd();
    const [textNode] = children;
    if (before && $isTextNode(textNode)) {
      textNode.setTextContent(before);
      parentNode.insertAfter(tweetNode);
      return;
    }
    parentNode.replace(tweetNode);
  },
  type: "element",
};

/**
 * An article carries a placeholder line ahead of the prose it renders as.
 * The prose is derived from the distilled HTML and cannot be parsed back, so
 * without the placeholder a round trip would flatten the node into plain
 * blocks; with it, a replace puts the node back and drops the prose it
 * derived. See PLACEHOLDER_BLOCK for how the line survives an import.
 */
export const ARTICLE: ElementTransformer = {
  dependencies: [ArticleNode],
  export: (node: LexicalNode) => {
    if (!ArticleNode.$isArticleNode(node)) return null;
    const data = node.getData();
    if (data.mode === "url") {
      const title = data.distilled.title || "Article";
      const body = htmlToPlainText(data.distilled.contentHtml || "");
      const source = data.url ? `\n\n[Source](${data.url})` : "";
      return `${$placeholderLine(node, title)}\n\n### ${title}${source}\n\n${body}`;
    }
    // entity mode
    const snap = data.snapshot;
    if (snap?.contentHtml) {
      const title = snap.title || "Article";
      const body = htmlToPlainText(snap.contentHtml || "");
      const source = data.entityId ? `\n\n[Saved](/urls/${data.entityId})` : "";
      return `${$placeholderLine(node, title)}\n\n### ${title}${source}\n\n${body}`;
    }
    return `${$placeholderLine(node, data.entityId ?? "")}\n\nArticle: ${data.entityId}`;
  },
  // An article's placeholder is what brings it back; a bare tag is prose.
  regExp: /^<article\s+.*?>$/,
  replace: (_parent, children, match, isImport) => {
    const [textNode] = children;
    if (isImport && $isTextNode(textNode)) {
      textNode.setTextContent(match[0] ?? "");
    }
    return false;
  },
  type: "element",
};

/**
 * Nodes with no markdown form export as `<!-- lexidraw:TYPE#N summary -->`.
 * N is the node's 1-based position among nodes of the same type in document
 * order, which is stable across reads of an unchanged document (node keys
 * are not). The summary is whatever a reader needs to recognise the node;
 * it is never parsed back.
 */
const PLACEHOLDER_SUMMARIES: ReadonlyArray<
  [(node: LexicalNode) => boolean, (node: LexicalNode) => string]
> = [
  [
    (node) => InlineImageNode.$isInlineImageNode(node),
    (node) => {
      const image = node as InlineImageNode;
      return `![${image.getAltText()}](${image.getSrc()})`;
    },
  ],
  [
    (node) => VideoNode.$isVideoNode(node),
    (node) => (node as VideoNode).getSrc(),
  ],
  [(node) => YouTubeNode.$isYouTubeNode(node), (node) => node.getTextContent()],
  [(node) => FigmaNode.$isFigmaNode(node), (node) => node.getTextContent()],
  [(node) => PageBreakNode.$isPageBreakNode(node), () => ""],
  [(node) => StickyNode.$isStickyNode(node), () => ""],
  [
    (node) => PollNode.$isPollNode(node),
    (node) => (node as PollNode).getQuestion(),
  ],
  [
    (node) => ChartNode.$isChartNode(node),
    (node) => (node as ChartNode).getChartType(),
  ],
  [
    (node) => SlideNode.$isSlideDeckNode(node),
    (node) => {
      const { slides } = (node as SlideNode).getData();
      const titles = slides
        .map((slide) => slide.slideMetadata?.storyboardTitle)
        .filter((title): title is string => Boolean(title));
      const suffix = titles.length > 0 ? `: ${titles.join(" / ")}` : "";
      return `${slides.length} slides${suffix}`;
    },
  ],
  [
    (node) => ExcalidrawNode.$isExcalidrawNode(node),
    (node) =>
      `${excalidrawElementCount((node as ExcalidrawNode).getData())} elements`,
  ],
  [
    (node) => MermaidNode.$isMermaidNode(node),
    (node) =>
      (node as MermaidNode)
        .getSchema()
        .split("\n")
        .find((line) => line.trim() !== "") ?? "",
  ],
  [
    (node) => CommentNode.$isCommentNode(node),
    (node) => (node as CommentNode).__comment.content,
  ],
  [
    (node) => ThreadNode.$isThreadNode(node),
    (node) => (node as ThreadNode).__thread.quote,
  ],
];

/**
 * Excalidraw stores `{ elements, files, appState }`; documents written before
 * that shape stored the element array on its own.
 */
function excalidrawElementCount(data: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return 0;
  }
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === "object") {
    const { elements } = parsed as { elements?: unknown };
    if (Array.isArray(elements)) return elements.length;
  }
  return 0;
}

const PLACEHOLDER_NODES = [
  InlineImageNode,
  VideoNode,
  YouTubeNode,
  FigmaNode,
  PageBreakNode,
  StickyNode,
  PollNode,
  ChartNode,
  SlideNode,
  ExcalidrawNode,
  MermaidNode,
  CommentNode,
  ThreadNode,
];

/**
 * The node types a placeholder can stand for, so a writer resolving one
 * against a stored document counts the same nodes the export numbered.
 */
export const PLACEHOLDER_NODE_TYPES: readonly string[] = [
  ...PLACEHOLDER_NODES.map((node) => node.getType()),
  ArticleNode.getType(),
];

export const PLACEHOLDER_PATTERN =
  /<!-- lexidraw:([a-z-]+)#(\d+)(?: (.*?))? -->/;

function $ordinalOf(node: LexicalNode): number {
  const type = node.getType();
  let ordinal = 0;
  for (const { node: candidate } of $dfs()) {
    if (candidate.getType() !== type) continue;
    ordinal += 1;
    if (candidate.is(node)) break;
  }
  return ordinal;
}

/**
 * A summary is a hint for a reader, so nothing in it may act as markdown: a
 * character an inline transformer triggers on would let the placeholder's own
 * text be re-parsed into a node on the way back in, taking the comment with
 * it. Dropping the characters is enough because the summary is never parsed.
 */
const MARKDOWN_ACTIVE = /[[\]()!*_`~$<>|]/g;

function $placeholderLine(node: LexicalNode, summary: string): string {
  // HTML comments cannot contain "--", so collapsing runs of dashes also
  // keeps the summary from closing the comment early.
  const cleaned = summary
    .replace(MARKDOWN_ACTIVE, " ")
    .replace(/-{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = cleaned ? ` ${cleaned}` : "";
  return `<!-- lexidraw:${node.getType()}#${$ordinalOf(node)}${suffix} -->`;
}

function $exportPlaceholder(node: LexicalNode): string | null {
  const entry = PLACEHOLDER_SUMMARIES.find(([matches]) => matches(node));
  if (!entry) return null;
  return $placeholderLine(node, entry[1](node));
}

/**
 * Block-level placeholder nodes. Import leaves the comment as literal text:
 * the node it stands for lives only in the stored document, so a later
 * write must resolve it against that document rather than recreate it here.
 */
export const PLACEHOLDER_BLOCK: ElementTransformer = {
  dependencies: PLACEHOLDER_NODES,
  export: $exportPlaceholder,
  regExp: new RegExp(`^${PLACEHOLDER_PATTERN.source}$`),
  replace: (_parent, children, match, isImport) => {
    // The importer strips the match from the line before asking and does
    // not put it back on a cancel.
    const [textNode] = children;
    if (isImport && $isTextNode(textNode)) {
      textNode.setTextContent(match[0] ?? "");
    }
    return false;
  },
  type: "element",
};

/**
 * Inline placeholder nodes. The import side claims the whole comment and
 * leaves it as text: the importer picks the outermost text match, so this
 * keeps IMAGE and EQUATION from turning a summary like `![alt](src)` into a
 * node. No trigger, so typing a placeholder does nothing.
 */
export const PLACEHOLDER_INLINE: TextMatchTransformer = {
  dependencies: PLACEHOLDER_NODES,
  export: $exportPlaceholder,
  importRegExp: PLACEHOLDER_PATTERN,
  regExp: new RegExp(`${PLACEHOLDER_PATTERN.source}$`),
  replace: () => {},
  type: "text-match",
};

export const DECORATOR_TRANSFORMERS = {
  multiline: [BLOCK_EQUATION_FENCE],
  element: [TWEET, ARTICLE, PLACEHOLDER_BLOCK, BLOCK_EQUATION],
  textMatch: [IMAGE, EQUATION, LITERAL_DOLLAR, PLACEHOLDER_INLINE],
};
