import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { $createHeadingNode } from "@lexical/rich-text";
import { $createTextNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

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
    parameters: z.object({
      text: z.string().describe("The text content of the heading."),
      tag: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
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
