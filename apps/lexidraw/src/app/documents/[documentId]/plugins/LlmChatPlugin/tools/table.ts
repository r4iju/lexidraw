import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createDocumentTable } from "@packages/lexical-nodes";
import { InsertTableSchema } from "@packages/types";

export const useTableTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();
  const insertTable = tool({
    description:
      "Inserts a new TableNode with the specified number of rows and columns, populating it with empty cells. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    inputSchema: InsertTableSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertTable",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { rows, columns } = specificOptions as {
            rows: number;
            columns: number;
          };

          const newTable = $createDocumentTable(rows, columns);

          $insertNodeAtResolvedPoint(resolution, newTable);

          return {
            primaryNodeKey: newTable.getKey(),
            summaryContext: `${rows}x${columns} table`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });
  return {
    insertTable,
  };
};
