import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { EquationNode } from "../../../nodes/EquationNode";
import {
  $isElementNode,
  $isTextNode,
  $createParagraphNode,
  $getNodeByKey,
  type LexicalNode,
} from "lexical";
export const useEquationTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertEquationNode = tool({
    description:
      "Inserts a new EquationNode with the provided LaTeX equation string. Can be inline or block-level. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      equation: z
        .string()
        .describe("The LaTeX equation string (e.g., 'E=mc^2')."),
      inline: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether the equation should be inline (renders as span) or block (renders as div). Defaults to false (block).",
        ),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
      return insertionExecutor(
        "insertEquationNode",
        editor,
        options,
        (resolution, specificOptions, currentTargetEditor) => {
          const { equation, inline } = specificOptions as {
            equation: string;
            inline?: boolean;
          };
          const newEquationNode = EquationNode.$createEquationNode(
            equation,
            inline ?? false,
          );

          let nodeToInsert: LexicalNode = newEquationNode;
          let finalNewNodeKey = newEquationNode.getKey();
          let summaryCtx = `${inline ? "inline" : "block"} equation`;

          if (resolution.type === "appendRoot") {
            if (inline) {
              const paragraph = $createParagraphNode();
              paragraph.append(newEquationNode);
              nodeToInsert = paragraph;
              finalNewNodeKey = paragraph.getKey();
              summaryCtx = `paragraph containing an inline equation`;
            }
            // If block, nodeToInsert remains newEquationNode
          } else {
            // Relative insertion
            const targetNode = currentTargetEditor
              .getEditorState()
              .read(() => $getNodeByKey(resolution.targetKey));
            if (!targetNode) {
              throw new Error(
                `Target node with key ${resolution.targetKey} not found for insertEquationNode.`,
              );
            }

            if (inline) {
              // For inline equations, wrap in a paragraph if the target isn't suitable for inline insertion.
              if (
                !(
                  $isTextNode(targetNode) ||
                  ($isElementNode(targetNode) && targetNode.isInline())
                )
              ) {
                const paragraph = $createParagraphNode();
                paragraph.append(newEquationNode);
                nodeToInsert = paragraph;
                finalNewNodeKey = paragraph.getKey();
                summaryCtx = `paragraph containing an inline equation`;
              }
            }
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

  return { insertEquationNode };
};
