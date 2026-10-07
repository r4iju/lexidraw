import { tool } from "ai";
import { useCommonUtilities } from "./common";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createToggle } from "@packages/lexical-nodes";
import { $createTextNode } from "lexical";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { PLAYGROUND_TRANSFORMERS } from "../../MarkdownTransformers";
import { InsertCollapsibleSectionSchema } from "@packages/types";
import type { z } from "zod";

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
      "Inserts a new toggle (collapsible section): a title, a paragraph or a heading per titleLevel, over content that folds away. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position.",
    inputSchema: InsertCollapsibleSectionSchema,
    execute: async (options) => {
      return insertionExecutor(
        "insertCollapsibleSection",
        editor,
        options,
        (resolution, specificOptions, _currentTargetEditor) => {
          const {
            titleText,
            titleLevel,
            initialContentMarkdown,
            initiallyOpen,
          } = specificOptions as z.infer<typeof InsertCollapsibleSectionSchema>;
          const markdown = initialContentMarkdown?.trim()
            ? initialContentMarkdown
            : null;
          const {
            container: containerNode,
            titleBlock,
            content,
          } = $createToggle(
            titleLevel,
            initiallyOpen,
            markdown ? [] : undefined,
          );
          titleBlock.append($createTextNode(titleText));
          if (markdown)
            $convertFromMarkdownString(
              markdown,
              PLAYGROUND_TRANSFORMERS,
              content,
            );

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
