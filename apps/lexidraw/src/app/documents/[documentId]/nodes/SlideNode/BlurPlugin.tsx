import type { EditorState } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { type JSX, useEffect } from "react";

interface BlurPluginProps {
  onBlur: (editorState: EditorState) => void;
}

export const BlurPlugin = ({ onBlur }: BlurPluginProps): JSX.Element | null => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const editorElement = editor.getRootElement();

    const handleBlur = () => {
      // Ensure editor is still mounted and editable before getting state
      // Check if the editor still has a root element and is part of the document
      // This check is a proxy for "isMounted" and "isEditable"
      if (editor.getRootElement() && editor.getRootElement()?.isConnected) {
        onBlur(editor.getEditorState());
      }
    };

    if (editorElement) {
      editorElement.addEventListener("blur", handleBlur, true); // Use capture phase
      return () => {
        editorElement.removeEventListener("blur", handleBlur, true);
      };
    }

    // Fallback for when root element might not be immediately available
    // or for editors that might get unmounted.
    // This listener handles the unmount scenario.
    const unregister = editor.registerRootListener(
      (rootElement, prevRootElement) => {
        if (prevRootElement !== null && rootElement === null) {
          // Editor unmounted
          // We might not have a valid editor state here if it's truly gone,
          // but lexical tries to provide the last known state.
          // Consider if onBlur should be called with a potentially stale state.
          // For now, following the original logic.
          onBlur(editor.getEditorState());
        }
      },
    );

    return () => {
      unregister();
    };
  }, [editor, onBlur]);

  return null;
};
