import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { AccessLevel } from "@packages/types";
import { useLayoutEffect } from "react";

/**
 * What a document is rendered for: a person viewing it in the app, the print
 * page a PDF is made from, or the page a thumbnail is captured from.
 */
export type RenderMode = "view" | "print" | "screenshot";

/** Whether this viewer could edit the document in this render at all. */
export function mayEdit(
  renderMode: RenderMode,
  accessLevel: AccessLevel,
): boolean {
  return renderMode === "view" && accessLevel === AccessLevel.EDIT;
}

/**
 * Holds the editor at `editable`. While it is false, an editor switched back
 * to editing from anywhere else — a block closing its own dialog, say — is
 * switched straight back, so read-only is not something a block can undo.
 */
export function EditabilityPlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useLayoutEffect(() => {
    editor.setEditable(editable);
    if (editable) return;
    return editor.registerEditableListener((isEditable) => {
      // After the change has reached every listener: switched back from
      // inside this one, the listeners after it would still hear "editable".
      if (isEditable) queueMicrotask(() => editor.setEditable(false));
    });
  }, [editor, editable]);
  return null;
}
