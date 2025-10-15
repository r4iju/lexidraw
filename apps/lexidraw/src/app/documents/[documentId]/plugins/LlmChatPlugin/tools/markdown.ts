import { tool } from "ai";
import { z } from "zod";
import {
  EditorKeySchema,
  InsertionAnchorSchema,
  InsertionRelationSchema,
} from "./common-schemas";
import { useCommonUtilities } from "./common";
import { $createParagraphNode, $getRoot } from "lexical";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { $getNodeByKey } from "lexical";
import type { InsertionPointResolution } from "./common-schemas";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { PLAYGROUND_TRANSFORMERS } from "../../MarkdownTransformers";

export const useMarkdownTools = () => {
  const { getResolvedEditorAndKeyMap, resolveInsertionPoint } =
    useCommonUtilities();
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
            // 1. create a temporary, detached parent node to hold the conversion output.
            //    this node itself is never inserted into the editor.  ParagraphNode works well as a generic ElementNode container.
            const tempParent = $createParagraphNode();

            // 2. run the conversion, targeting the temporary parent.
            //    lexical will fill tempParent with the correct top-level nodes.
            //    e.g., for "# Hello\n\nWorld", it will add a HeadingNode and a ParagraphNode.
            $convertFromMarkdownString(
              markdownText,
              PLAYGROUND_TRANSFORMERS,
              tempParent,
            );

            const nodesToInsert = tempParent.getChildren();

            if (nodesToInsert.length === 0) {
              console.log(
                "[insertMarkdown] Markdown produced no nodes, exiting.",
              );
              return;
            }

            // a bit more logic than $insertNodeAtResolvedPoint because we are inserting an array of nodes.
            if (successResolution.type === "appendRoot") {
              console.log(
                `[insertMarkdown] Appending ${nodesToInsert.length} nodes to the root.`,
              );
              const root = $getRoot();
              nodesToInsert.forEach((node) => root.append(node));
            } else {
              const targetNode = $getNodeByKey(successResolution.targetKey);
              if (!targetNode) {
                console.error(
                  `[insertMarkdown] Target node with key ${successResolution.targetKey} not found.`,
                );
                return;
              }

              if (successResolution.type === "before") {
                nodesToInsert.forEach((node) => targetNode.insertBefore(node));
              } else if (successResolution.type === "after") {
                // track the last inserted node.
                let lastInsertedNode = targetNode;
                nodesToInsert.forEach((node) => {
                  lastInsertedNode.insertAfter(node);
                  lastInsertedNode = node; // the next node should be inserted after this one.
                });
              }
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
