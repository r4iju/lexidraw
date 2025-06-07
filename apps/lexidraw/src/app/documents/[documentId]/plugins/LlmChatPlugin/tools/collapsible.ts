import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { CollapsibleContainerNode } from "../../CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleTitleNode } from "../../CollapsiblePlugin/CollapsibleTitleNode";
import { $createParagraphNode, $createTextNode } from "lexical";
import { CollapsibleContentNode } from "../../CollapsiblePlugin/CollapsibleContentNode";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { PLAYGROUND_TRANSFORMERS } from "../../MarkdownTransformers";

export const useCollapsibleTools = () => {
  const {
    insertionExecutor,
    $insertNodeAtResolvedPoint,
    resolveInsertionPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  /* --------------------------------------------------------------
   * Insert CollapsibleSection Tool
   * --------------------------------------------------------------*/
  const insertCollapsibleSection = tool({
    description:
      "Inserts a new collapsible section (container, title, and content). Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    parameters: z.object({
      titleText: z.string().describe("The text for the collapsible title."),
      initialContentMarkdown: z
        .string()
        .optional()
        .describe(
          "Optional Markdown content for the collapsible body. If empty, an empty paragraph is created.",
        ),
      initiallyOpen: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether the section is open by default. Defaults to false."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async (options) => {
      return insertionExecutor(
        "insertCollapsibleSection",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const { titleText, initialContentMarkdown, initiallyOpen } =
            specificOptions as {
              titleText: string;
              initialContentMarkdown?: string;
              initiallyOpen?: boolean;
            };

          const containerNode =
            CollapsibleContainerNode.$createCollapsibleContainerNode(
              initiallyOpen ?? false,
            );
          const titleNode = CollapsibleTitleNode.$createCollapsibleTitleNode();
          const titleParagraph = $createParagraphNode().append(
            $createTextNode(titleText),
          );
          titleNode.append(titleParagraph);

          const contentNode =
            CollapsibleContentNode.$createCollapsibleContentNode();
          if (initialContentMarkdown && initialContentMarkdown.trim() !== "") {
            $convertFromMarkdownString(
              initialContentMarkdown,
              PLAYGROUND_TRANSFORMERS,
              contentNode,
            );
          }
          if (contentNode.isEmpty()) {
            // Ensure content is not empty
            contentNode.append($createParagraphNode());
          }

          containerNode.append(titleNode, contentNode);

          $insertNodeAtResolvedPoint(resolution, containerNode);

          return {
            primaryNodeKey: containerNode.getKey(),
            summaryContext: `collapsible section titled '${titleText}'`,
          };
        },
        resolveInsertionPoint,
      );
    },
  });

  return { insertCollapsibleSection };
};
