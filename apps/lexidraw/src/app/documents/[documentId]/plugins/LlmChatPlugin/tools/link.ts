import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createLinkNode } from "@lexical/link";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
} from "lexical";

export const useLinkTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertLinkNode = tool({
    description:
      "Inserts a new LinkNode with the provided URL and optional text. If linkText is not provided, the URL itself will be used as the visible text. The LinkNode is inline; if inserted at the root or relative to a block-level node, it will be wrapped in a ParagraphNode.",
    parameters: z.object({
      url: z
        .string()
        .describe("The URL for the link (e.g., 'https://example.com')."),
      linkText: z
        .string()
        .optional()
        .describe(
          "The visible text for the link. Defaults to the URL if not provided.",
        ),
      attributes: z
        .object({
          rel: z
            .string()
            .optional()
            .describe(
              "The 'rel' attribute for the link (e.g., 'noopener noreferrer').",
            ),
          target: z
            .string()
            .optional()
            .describe("The 'target' attribute for the link (e.g., '_blank')."),
          title: z
            .string()
            .optional()
            .describe("The 'title' attribute for the link."),
        })
        .optional()
        .describe("Optional HTML attributes for the link."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
      return insertionExecutor(
        "insertLinkNode",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { url, linkText, attributes } = specificOptions as {
            url: string;
            linkText?: string;
            attributes?: { rel?: string; target?: string; title?: string };
          };

          const actualLinkText = linkText || url;
          const newLinkNode = $createLinkNode(url, attributes);
          newLinkNode.append($createTextNode(actualLinkText));

          let nodeToInsert: LexicalNode = newLinkNode;
          let summaryCtx = `link to '${url}'`;
          let finalNewNodeKey = newLinkNode.getKey();

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newLinkNode);
            nodeToInsert = paragraph;
            finalNewNodeKey = paragraph.getKey();
            summaryCtx = `paragraph containing a link to '${url}'`;
          } else {
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertLinkNode.`,
              );
            }
            if (
              !(
                $isTextNode(targetNode) ||
                ($isElementNode(targetNode) && targetNode.isInline())
              )
            ) {
              const paragraph = $createParagraphNode();
              paragraph.append(newLinkNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = `paragraph containing a link to '${url}'`;
            }
          }

          $insertNodeAtResolvedPoint(resolution, nodeToInsert);

          return {
            primaryNodeKey: finalNewNodeKey,
            summaryContext: summaryCtx,
          };
        },
        resolveInsertionPoint,
      );
    },
  });
  return {
    insertLinkNode,
  };
};
