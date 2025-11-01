import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTableNode } from "@lexical/table";
import { $createTableRowNode } from "@lexical/table";
import { $createTableCellNode } from "@lexical/table";
import { $createParagraphNode } from "lexical";
import { $createTextNode } from "lexical";
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
