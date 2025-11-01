import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { CollapsibleContainerNode } from "../../CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleTitleNode } from "../../CollapsiblePlugin/CollapsibleTitleNode";
import { $createParagraphNode, $createTextNode } from "lexical";
import { CollapsibleContentNode } from "../../CollapsiblePlugin/CollapsibleContentNode";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { PLAYGROUND_TRANSFORMERS } from "../../MarkdownTransformers";
import { InsertCollapsibleSectionSchema } from "@packages/types";

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
    inputSchema: InsertCollapsibleSectionSchema,
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
