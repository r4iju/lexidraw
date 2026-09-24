import type {
  ElementTransformer,
  TextMatchTransformer,
} from "@lexical/markdown";
import {
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
} from "./nodes/FootnoteNode.js";

/** `[^label]: text`, a GitHub footnote on one line. */
export const FOOTNOTE_DEFINITION: ElementTransformer = {
  dependencies: [FootnoteDefinitionNode],
  export: (node, exportChildren) =>
    FootnoteDefinitionNode.$isFootnoteDefinitionNode(node)
      ? `[^${node.getLabel()}]: ${exportChildren(node)}`
      : null,
  regExp: /^\[\^([^\]\s]+)\]:\s+/,
  replace: (parentNode, children, match, isImport) => {
    if (!isImport) return false;
    const definition = FootnoteDefinitionNode.$createFootnoteDefinitionNode(
      match[1] ?? "",
    );
    definition.append(...children);
    parentNode.replace(definition);
  },
  type: "element",
};

/** `[^label]`, the marker in the text; typing one does nothing. */
export const FOOTNOTE_REFERENCE: TextMatchTransformer = {
  dependencies: [FootnoteReferenceNode],
  export: (node) =>
    FootnoteReferenceNode.$isFootnoteReferenceNode(node)
      ? `[^${node.getLabel()}]`
      : null,
  importRegExp: /\[\^([^\]\s]+)\](?!:)/,
  regExp: /\[\^([^\]\s]+)\]$/,
  replace: (textNode, match) => {
    textNode.replace(
      FootnoteReferenceNode.$createFootnoteReferenceNode(match[1] ?? ""),
    );
  },
  type: "text-match",
};
