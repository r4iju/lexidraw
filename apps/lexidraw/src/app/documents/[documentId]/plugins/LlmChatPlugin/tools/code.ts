import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createCodeHighlightNode,
  $createCodeNode,
  $isCodeHighlightNode,
} from "@lexical/code";
import {
  $createParagraphNode,
  $isTextNode,
  $createTextNode,
  type LexicalNode,
  $getNodeByKey,
} from "lexical";
import {
  InsertCodeBlockSchema,
  InsertCodeHighlightNodeSchema,
} from "@packages/types";

export const useCodeTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertCodeBlock = tool({
    description:
      "Inserts a new CodeNode (code block). Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Can optionally set the language and initial text content.",
    inputSchema: InsertCodeBlockSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertCodeBlock",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { language, initialText } = specificOptions as {
            language?: string;
            initialText?: string;
          };

          const newCodeNode = $createCodeNode();
          if (language) {
            // Safely check for and call setLanguage if it exists
            if (
              "setLanguage" in newCodeNode &&
              typeof newCodeNode.setLanguage === "function"
            ) {
              newCodeNode.setLanguage(language);
            } else {
              console.warn(
                `[insertCodeBlock:inserter] Could not set language '${language}' on CodeNode. Method setLanguage might not exist or is not callable.`,
              );
            }
          }
          if (initialText) {
            newCodeNode.append($createTextNode(initialText));
          }

          $insertNodeAtResolvedPoint(resolution, newCodeNode);

          return {
            primaryNodeKey: newCodeNode.getKey(),
            summaryContext: `Code Block${language ? ` (${language})` : ""}`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });

  const insertCodeHighlightNode = tool({
    description:
      "Inserts a new CodeHighlightNode containing the provided text. This node is a special TextNode that will be highlighted if it is within a CodeNode. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    inputSchema: InsertCodeHighlightNodeSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertCodeHighlightNode",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { text } = specificOptions as { text: string };
          const newHighlightNode = $createCodeHighlightNode(text);
          let nodeToInsert: LexicalNode = newHighlightNode;
          let summaryCtx = "CodeHighlightNode";
          let finalNewNodeKey = newHighlightNode.getKey();

          if (resolution.type === "appendRoot") {
            const paragraph = $createParagraphNode();
            paragraph.append(newHighlightNode);
            nodeToInsert = paragraph;
            finalNewNodeKey = paragraph.getKey();
            summaryCtx = "paragraph containing CodeHighlightNode";
          } else {
            // Relative insertion
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertCodeHighlightNode.`,
              );
            }

            // If target is not suitable for direct inline insertion, wrap in a paragraph.
            if (
              !($isTextNode(targetNode) || $isCodeHighlightNode(targetNode))
            ) {
              const paragraph = $createParagraphNode();
              paragraph.append(newHighlightNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = "paragraph containing CodeHighlightNode";
            }
            // If target IS a TextNode or CodeHighlightNode, nodeToInsert remains newHighlightNode
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
    insertCodeBlock,
    insertCodeHighlightNode,
  };
};
