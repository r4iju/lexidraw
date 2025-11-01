import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { $createHeadingNode } from "@lexical/rich-text";
import { $createTextNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { InsertHeadingNodeSchema } from "@packages/types";

export const useHeadingTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertHeadingNode = tool({
    description:
      "Inserts a new HeadingNode with the specified tag and text. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    inputSchema: InsertHeadingNodeSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertHeadingNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { text, tag } = specificOptions as {
            text: string;
            tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          };
          const newHeadingNode = $createHeadingNode(tag).append(
            $createTextNode(text),
          );

          // 🩹 If appending to root and the first child is still the placeholder
          // empty paragraph from EMPTY_CONTENT, remove that paragraph first so we
          // don't end up with a blank line before the heading.
          if (resolution.type === "appendRoot") {
            const root = $getRoot();
            const firstChild = root.getFirstChild();
            if (
              firstChild &&
              firstChild.getType() === "paragraph" &&
              firstChild.getTextContent() === ""
            ) {
              firstChild.remove();
            }
          }

          $insertNodeAtResolvedPoint(resolution, newHeadingNode);

          return {
            primaryNodeKey: newHeadingNode.getKey(),
            summaryContext: `${tag} heading`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });

  return {
    insertHeadingNode,
  };
};
