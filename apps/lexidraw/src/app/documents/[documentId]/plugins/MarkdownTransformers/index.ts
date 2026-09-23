import type {
  ElementTransformer,
  TextMatchTransformer,
  Transformer,
} from "@lexical/markdown";
import { $createTextNode, type LexicalNode } from "lexical";
import { createTransformers, htmlToPlainText } from "@packages/lexical-nodes";
import { EquationNode } from "../../nodes/EquationNode";
import { ImageNode } from "../../nodes/ImageNode/ImageNode";
import { TweetNode } from "../../nodes/TweetNode";
import { ArticleNode } from "../../nodes/ArticleNode/ArticleNode";

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

export const ARTICLE: ElementTransformer = {
  dependencies: [ArticleNode],
  export: (node: LexicalNode) => {
    if (!ArticleNode.$isArticleNode(node)) return null;
    const data = node.getData();
    if (data.mode === "url") {
      const title = data.distilled.title || "Article";
      const body = htmlToPlainText(data.distilled.contentHtml || "");
      const source = data.url ? `\n\n[Source](${data.url})` : "";
      return `### ${title}${source}\n\n${body}`;
    }
    // entity mode
    const snap = data.snapshot;
    if (snap?.contentHtml) {
      const title = snap.title || "Article";
      const body = htmlToPlainText(snap.contentHtml || "");
      const source = data.entityId ? `\n\n[Saved](/urls/${data.entityId})` : "";
      return `### ${title}${source}\n\n${body}`;
    }
    return `Article: ${data.entityId}`;
  },
  // Minimal, no-op import behavior (we don't import articles from markdown)
  regExp: /^<article\s+.*?>$/,
  replace: (textNode) => {
    textNode.replace($createTextNode("Article"));
  },
  type: "element",
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

// Decorator-node transformers stay here until their nodes move into the
// package; the package supplies the rest and the nested-conversion wiring.
export const PLAYGROUND_TRANSFORMERS: Transformer[] = createTransformers([
  ARTICLE,
  IMAGE,
  EQUATION,
  TWEET,
]);
