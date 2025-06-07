import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { $createParagraphNode } from "lexical";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { $getNodeByKey } from "lexical";
import { $isElementNode } from "lexical";
import { InsertionPointResolution } from "./common-schemas";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { PLAYGROUND_TRANSFORMERS } from "../../MarkdownTransformers";

export const useMarkdownTools = () => {
  const {
    getResolvedEditorAndKeyMap,
    resolveInsertionPoint,
    $insertNodeAtResolvedPoint,
  } = useCommonUtilities();
  const [editor] = useLexicalComposerContext();

  const insertMarkdown = tool({
    description:
      "Inserts content parsed from a Markdown string. Uses relation ('before', 'after', 'appendRoot') and anchor (key or text) to determine position. This is efficient for inserting complex structures like multiple paragraphs, lists, headings, code blocks, etc., defined in Markdown format.",
    parameters: z.object({
      markdownText: z
        .string()
        .describe("The Markdown content to parse and insert."),
      relation: InsertionRelationSchema,
      anchor: InsertionAnchorSchema.optional(),
      editorKey: EditorKeySchema.optional(),
    }),
    execute: async ({ markdownText, relation, anchor, editorKey }) => {
      try {
        console.log("[insertMarkdown] Starting", {
          markdownText,
          relation,
          anchor,
        });

        const editorContext = getResolvedEditorAndKeyMap(editorKey || "main");

        const resolution = await resolveInsertionPoint(
          editorContext,
          relation,
          anchor,
        );

        if (resolution.status === "error") {
          console.error(
            `❌ [insertMarkdown] Error resolving insertion point: ${resolution.message}`,
          );
          return { success: false, error: resolution.message };
        }

        // After status check, resolution is of success type
        const successResolution = resolution as Exclude<
          InsertionPointResolution,
          { status: "error" }
        >;

        editorContext.targetEditor.update(
          () => {
            const placeholderNode = $createParagraphNode();
            // Insert the placeholder first using our helper
            $insertNodeAtResolvedPoint(successResolution, placeholderNode);

            // Now, convert markdown targeting the placeholder.
            // $convertFromMarkdownString may replace placeholderNode or fill it.
            console.log(
              `[insertMarkdown] Calling $convertFromMarkdownString, targeting placeholder node: ${placeholderNode.getKey()}`,
            );
            $convertFromMarkdownString(
              markdownText,
              PLAYGROUND_TRANSFORMERS,
              placeholderNode, // Target the placeholder
            );

            // Check the node by key again as it might have been replaced or removed
            // and then re-added by $convertFromMarkdownString if markdown was empty.
            const finalNode = $getNodeByKey(placeholderNode.getKey());
            if (
              finalNode &&
              $isElementNode(finalNode) &&
              finalNode.isAttached() &&
              finalNode.isEmpty()
            ) {
              console.log(
                `[insertMarkdown] Placeholder node ${finalNode.getKey()} is empty after conversion, removing it.`,
              );
              finalNode.remove();
            }
          },
          { tag: "llm-insert-markdown" },
        );

        const latestState = editor.getEditorState();
        const stateJson = latestState.toJSON();

        const targetKeyForSummary =
          successResolution.type === "appendRoot"
            ? "root"
            : successResolution.targetKey;
        const summary =
          successResolution.type === "appendRoot"
            ? `Appended content from Markdown.`
            : `Inserted content from Markdown ${successResolution.type} target (key: ${targetKeyForSummary ?? "N/A"}).`;
        console.log(`✅ [insertMarkdown] Success: ${summary}`);

        return {
          success: true,
          content: { summary, updatedEditorStateJson: stateJson },
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`❌ [insertMarkdown] Error:`, errorMsg);
        let stateJsonOnError = {};
        try {
          stateJsonOnError = editor.getEditorState().toJSON();
        } catch (stateErr) {
          console.error("Failed to serialize state on error:", stateErr);
        }
        return {
          success: false,
          error: errorMsg,
          content: {
            summary: "Failed to insert content from Markdown",
            updatedEditorStateJson: stateJsonOnError,
          },
        };
      }
    },
  });

  return {
    insertMarkdown,
  };
};
