import type { EditorState } from "lexical";
import { useCallback } from "react";
import { $convertToMarkdownString } from "@lexical/markdown";
import { $getRoot } from "lexical";
import { PLAYGROUND_TRANSFORMERS } from "../plugins/MarkdownTransformers";

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

  return {
    convertEditorStateToMarkdown,
  };
};
