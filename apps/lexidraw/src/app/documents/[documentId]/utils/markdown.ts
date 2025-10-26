import type { EditorState } from "lexical";
import { useCallback } from "react";
import { $convertToMarkdownString } from "@lexical/markdown";
import { PLAYGROUND_TRANSFORMERS } from "../plugins/MarkdownTransformers";

export const useMarkdownTools = () => {
  const convertEditorStateToMarkdown = useCallback(
    (editorState: EditorState): string => {
      return editorState.read(() => {
        try {
          // Proper Markdown export using our transformers (includes ArticleNode)
          const md = $convertToMarkdownString(PLAYGROUND_TRANSFORMERS);
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
