import type { ElementTransformer, Transformer } from "@lexical/markdown";
import { createTransformers, htmlToPlainText } from "@packages/lexical-nodes";
import { $createTextNode, type LexicalNode } from "lexical";
import { ArticleNode } from "../../nodes/ArticleNode/ArticleNode";

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

// The article node still needs browser-only modules, so its transformer
// stays here; the package supplies every other transformer.
export const PLAYGROUND_TRANSFORMERS: Transformer[] = createTransformers([
  ARTICLE,
]);
