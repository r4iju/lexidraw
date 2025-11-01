import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { FigmaNode } from "../../../nodes/FigmaNode";
import { InsertFigmaNodeSchema } from "@packages/types";

export const useFigmaTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertFigmaNode = tool({
    description:
      "Inserts a Figma embed using the provided Figma document ID. FigmaNode is a block-level element. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. Optionally, a format (e.g., 'center') can be applied.",
    inputSchema: InsertFigmaNodeSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertFigmaNode",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { documentID, format } = specificOptions as {
            documentID: string;
            format?: "left" | "center" | "right" | "justify";
          };
          const newFigmaNode = FigmaNode.$createFigmaNode(documentID);
          if (format) {
            newFigmaNode.setFormat(format);
          }

          $insertNodeAtResolvedPoint(resolution, newFigmaNode);

          return {
            primaryNodeKey: newFigmaNode.getKey(),
            summaryContext: `Figma embed (ID: ${documentID})`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });
  return {
    insertFigmaNode,
  };
};
