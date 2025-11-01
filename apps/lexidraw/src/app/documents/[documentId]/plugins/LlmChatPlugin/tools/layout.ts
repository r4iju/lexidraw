import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode } from "lexical";
import { LayoutContainerNode } from "../../../nodes/LayoutContainerNode";
import { LayoutItemNode } from "../../../nodes/LayoutItemNode";
import { InsertLayoutSchema } from "@packages/types";

export const useLayoutTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertLayout = tool({
    description:
      "Inserts a new layout container with a specified column structure. Each column (LayoutItemNode) will be initialized with an empty paragraph. The number of columns is determined by the space-separated values in templateColumns (e.g., '1fr 1fr' creates two columns). Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    inputSchema: InsertLayoutSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertLayout",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { templateColumns } = specificOptions as {
            templateColumns: string;
          };

          const containerNode =
            LayoutContainerNode.$createLayoutContainerNode(templateColumns);

          const columnDefinitions = templateColumns
            .split(" ")
            .filter((def) => def.trim() !== "");
          const numberOfColumns = columnDefinitions.length;

          if (numberOfColumns === 0) {
            const emptyParagraph = $createParagraphNode();
            containerNode.append(emptyParagraph);
          } else {
            for (let i = 0; i < numberOfColumns; i++) {
              const itemNode = LayoutItemNode.$createLayoutItemNode();
              const paragraphNode = $createParagraphNode();
              itemNode.append(paragraphNode);
              containerNode.append(itemNode);
            }
          }

          $insertNodeAtResolvedPoint(resolution, containerNode);

          return {
            primaryNodeKey: containerNode.getKey(),
            summaryContext: `layout with columns: ${templateColumns}`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });

  return {
    insertLayout,
  };
};
