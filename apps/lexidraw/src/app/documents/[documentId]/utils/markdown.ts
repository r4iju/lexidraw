import type { EditorState, LexicalEditor } from "lexical";
import { useCallback } from "react";
import {
  $convertToMarkdownString,
  $convertFromMarkdownString,
} from "@lexical/markdown";
import { $getRoot, $createParagraphNode } from "lexical";
import { PLAYGROUND_TRANSFORMERS } from "../plugins/MarkdownTransformers";

export type MarkdownInsertMode = "start" | "end" | "replace";

export const useMarkdownTools = () => {
  const convertEditorStateToMarkdown = useCallback(
    (editorState: EditorState): string => {
      return editorState.read(() => {
        try {
          // Always export the whole document by converting from root node
          // This ensures we export everything even if there's a selection
          const root = $getRoot();
          const md = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, root);
          return md?.trim() ?? "";
        } catch (e) {
          console.error("[convertEditorStateToMarkdown] export error:", e);
          return "";
        }
      });
    },
    [],
  );

  const insertMarkdown = useCallback(
    (editor: LexicalEditor, markdown: string, mode: MarkdownInsertMode) => {
      editor.update(() => {
        const root = $getRoot();

        try {
          // Create a temporary parent node to hold the conversion output
          // This node itself is never inserted into the editor
          const tempParent = $createParagraphNode();

          // Run the conversion, targeting the temporary parent
          // Lexical will fill tempParent with the correct top-level nodes
          $convertFromMarkdownString(
            markdown,
            PLAYGROUND_TRANSFORMERS,
            tempParent,
          );

          const nodesToInsert = tempParent.getChildren();

          if (nodesToInsert.length === 0) {
            console.log("[insertMarkdown] Markdown produced no nodes");
            return;
          }

          if (mode === "replace") {
            root.clear();
            for (const node of nodesToInsert) {
              root.append(node);
            }
          } else if (mode === "start") {
            // Get existing children before clearing
            const existingChildren = root.getChildren();
            root.clear();
            // Append imported nodes first
            for (const node of nodesToInsert) {
              root.append(node);
            }
            // Then append existing children
            for (const child of existingChildren) {
              root.append(child);
            }
          } else if (mode === "end") {
            // Append imported nodes to the end
            for (const node of nodesToInsert) {
              root.append(node);
            }
          }
        } catch (e) {
          console.error("[insertMarkdown] import error:", e);
          throw e;
        }
      });
    },
    [],
  );

  return {
    convertEditorStateToMarkdown,
    insertMarkdown,
  };
};
