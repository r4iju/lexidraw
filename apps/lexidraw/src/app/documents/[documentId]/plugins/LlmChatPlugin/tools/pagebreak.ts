import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { PageBreakNode } from "../../../nodes/PageBreakNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

export const usePageBreakTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();
  const insertPageBreakNode = tool({
    description:
      "Inserts a new PageBreakNode. This is a block-level element that typically forces a page break when printing or exporting to PDF. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    inputSchema: z.object({
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
      return insertionExecutor(
        "insertPageBreakNode",
        editor,
        options,
        (resolution, _specificOptions, _currentTargetEditor) => {
          const newPageBreak = PageBreakNode.$createPageBreakNode();
          $insertNodeAtResolvedPoint(resolution, newPageBreak);
          return {
            primaryNodeKey: newPageBreak.getKey(),
            summaryContext: "Page Break",
          };
        },
        resolveInsertionPoint,
      );
    },
  });
  return {
    insertPageBreakNode,
  };
};
