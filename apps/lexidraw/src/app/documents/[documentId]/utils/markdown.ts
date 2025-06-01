import { $getRoot, EditorState } from "lexical";
import { useCallback } from "react";

export const useMarkdownTools = () => {
  const convertEditorStateToMarkdown = useCallback(
    (editorState: EditorState): string => {
      console.warn(
        "[convertEditorStateToMarkdown] Using placeholder implementation. This needs refinement.",
      );
      return editorState.read(() => {
        try {
          // Attempt a very basic text extraction as a fallback
          // Use more specific types where possible
          const root = $getRoot();
          const rootChildren = root.getChildren();
          const textContent = rootChildren
            .map((node) => node.getTextContent())
            .join("\n");

          return textContent.trim() !== ""
            ? textContent
            : "[Unable to generate basic Markdown preview - Empty Document?]";
        } catch (e: unknown) {
          // Type the error
          console.error(
            "[convertEditorStateToMarkdown] Error during placeholder conversion:",
            e,
          ); // Log the error
          return "[Error generating Markdown preview]";
        }
      });
    },
    [],
  );

  return {
    convertEditorStateToMarkdown,
  };
};
