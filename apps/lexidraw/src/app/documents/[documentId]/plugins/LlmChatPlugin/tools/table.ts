import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTableNode } from "@lexical/table";
import { $createTableRowNode } from "@lexical/table";
import { $createTableCellNode } from "@lexical/table";
import { $createParagraphNode } from "lexical";
import { $createTextNode } from "lexical";

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
    parameters: z.object({
      rows: z.number().min(1).describe("The number of rows for the table."),
      columns: z
        .number()
        .min(1)
        .describe("The number of columns for the table."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
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

          const newTable = $createTableNode();

          for (let i = 0; i < rows; i++) {
            const tableRow = $createTableRowNode();
            for (let j = 0; j < columns; j++) {
              const tableCell = $createTableCellNode();
              const paragraph = $createParagraphNode();
              paragraph.append($createTextNode("")); // Ensure cell is editable
              tableCell.append(paragraph);
              tableRow.append(tableCell);
            }
            newTable.append(tableRow);
          }

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
