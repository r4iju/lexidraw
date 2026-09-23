import type {
  ElementTransformer,
  TextMatchTransformer,
} from "@lexical/markdown";
import { $dfs } from "@lexical/utils";
import { $createTextNode, $isTextNode, type LexicalNode } from "lexical";
import { htmlToPlainText } from "./html-to-text.js";
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

export const IMAGE: TextMatchTransformer = {
  dependencies: [ImageNode],
  export: (node) => {
    if (!ImageNode.$isImageNode(node)) {
      return null;
    }

    return `![${node.getAltText()}](${node.getSrc()})`;
  },
  importRegExp: /!(?:\[([^[]*)\])(?:\(([^(]+)\))/,
  regExp: /!(?:\[([^[]*)\])(?:\(([^(]+)\))$/,
  replace: (textNode, match) => {
    const [, altText, src] = match;
    const imageNode = ImageNode.$createImageNode({
      altText: altText as string,
      maxWidth: 800,
      src: src as string,
    });
    textNode.replace(imageNode);
  },
  trigger: ")",
  type: "text-match",
};

export const EQUATION: TextMatchTransformer = {
  dependencies: [EquationNode],
  export: (node) => {
    if (!EquationNode.$isEquationNode(node)) {
      return null;
    }

    return `$${node.getEquation()}$`;
  },
  importRegExp: /\$([^$]+?)\$/,
  regExp: /\$([^$]+?)\$$/,
  replace: (textNode, match) => {
    const [, equation] = match;
    const equationNode = EquationNode.$createEquationNode(equation, true);
    textNode.replace(equationNode);
  },
  trigger: "$",
  type: "text-match",
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
  replace: (textNode, _1, match) => {
    const [, id] = match;
    if (!id) return;
    const tweetNode = TweetNode.$createTweetNode(id);
    textNode.replace(tweetNode);
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
    return `${$placeholderLine(node, data.entityId)}\n\nArticle: ${data.entityId}`;
  },
  // Minimal, no-op import behavior (we don't import articles from markdown)
  regExp: /^<article\s+.*?>$/,
  replace: (textNode) => {
    textNode.replace($createTextNode("Article"));
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

function $placeholderLine(node: LexicalNode, summary: string): string {
  // HTML comments cannot contain "--", so collapsing runs of dashes also
  // keeps the summary from closing the comment early.
  const cleaned = summary.replace(/-{2,}/g, "-").replace(/\s+/g, " ").trim();
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
  element: [TWEET, ARTICLE, PLACEHOLDER_BLOCK],
  textMatch: [IMAGE, EQUATION, PLACEHOLDER_INLINE],
};
