import type {
  ElementTransformer,
  TextMatchTransformer,
} from "@lexical/markdown";
import { $dfs } from "@lexical/utils";
import { $isTextNode, type LexicalNode } from "lexical";
import { ChartNode } from "./nodes/ChartNode.js";
import { EquationNode } from "./nodes/EquationNode.js";
import { FigmaNode } from "./nodes/FigmaNode.js";
import { ImageNode } from "./nodes/ImageNode.js";
import { InlineImageNode } from "./nodes/InlineImageNode.js";
import { PageBreakNode } from "./nodes/PageBreakNode.js";
import { PollNode } from "./nodes/PollNode.js";
import { StickyNode } from "./nodes/StickyNode.js";
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
    (node) => (node as PollNode).__question,
  ],
  [
    (node) => ChartNode.$isChartNode(node),
    (node) => (node as ChartNode).getChartType(),
  ],
];

const PLACEHOLDER_NODES = [
  InlineImageNode,
  VideoNode,
  YouTubeNode,
  FigmaNode,
  PageBreakNode,
  StickyNode,
  PollNode,
  ChartNode,
];

const PLACEHOLDER_PATTERN = /<!-- lexidraw:([a-z-]+)#(\d+)(?: (.*?))? -->/;

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

function $exportPlaceholder(node: LexicalNode): string | null {
  const entry = PLACEHOLDER_SUMMARIES.find(([matches]) => matches(node));
  if (!entry) return null;
  const summary = entry[1](node)
    .replace(/-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = summary ? ` ${summary}` : "";
  return `<!-- lexidraw:${node.getType()}#${$ordinalOf(node)}${suffix} -->`;
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

/** Inline placeholder nodes; export-only, so the comment stays literal text. */
export const PLACEHOLDER_INLINE: TextMatchTransformer = {
  dependencies: PLACEHOLDER_NODES,
  export: $exportPlaceholder,
  regExp: new RegExp(`${PLACEHOLDER_PATTERN.source}$`),
  type: "text-match",
};

export const DECORATOR_TRANSFORMERS = {
  element: [TWEET, PLACEHOLDER_BLOCK],
  textMatch: [IMAGE, EQUATION, PLACEHOLDER_INLINE],
};
