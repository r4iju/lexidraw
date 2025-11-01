import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $isTextNode,
  $getNodeByKey,
  type LexicalNode,
} from "lexical";
import { $createHashtagNode, $isHashtagNode } from "@lexical/hashtag";
import { InsertHashtagSchema } from "@packages/types";

export const useHashtagTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();
  const insertHashtag = tool({
    description:
      "Inserts a new HashtagNode with the provided text. If relation is 'appendRoot' or the anchor is block-level, it's wrapped in a ParagraphNode.",
    inputSchema: InsertHashtagSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertHashtag",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { text } = specificOptions as { text: string };
          const newHashtagNode = $createHashtagNode(text);
          let nodeToInsert: LexicalNode = newHashtagNode;
          let summaryCtx = `hashtag '#${text}'`;
          let finalNewNodeKey = newHashtagNode.getKey();

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newHashtagNode);
            nodeToInsert = paragraph;
            finalNewNodeKey = paragraph.getKey();
            summaryCtx = `paragraph containing hashtag '#${text}'`;
          } else {
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertHashtag.`,
              );
            }
            // If target is not suitable for direct inline insertion (e.g., not a TextNode or another HashtagNode),
            // wrap the HashtagNode in a paragraph.
            if (!($isTextNode(targetNode) || $isHashtagNode(targetNode))) {
              const paragraph = $createParagraphNode();
              paragraph.append(newHashtagNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = `paragraph containing hashtag '#${text}'`;
            }
            // If target IS a TextNode/HashtagNode, nodeToInsert remains newHashtagNode
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

  return { insertHashtag };
};
