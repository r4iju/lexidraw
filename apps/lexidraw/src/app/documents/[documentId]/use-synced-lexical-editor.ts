"use client";

import type { EditorState, LexicalEditor } from "lexical";
import { useEffect, useMemo, useRef } from "react";
import type { SyncedEditor } from "~/lib/open-entity-sync";
import { trackLexicalEdits } from "./lexical-edits";

/** `trackLexicalEdits` for the mounted editor; `onReplace` sees each reload. */
export function useSyncedLexicalEditor(
  editor: LexicalEditor,
  onReplace: (editorState: EditorState) => void,
): SyncedEditor {
  const tracked = useRef<ReturnType<typeof trackLexicalEdits> | null>(null);

  // External system: the Lexical editors' update streams.
  useEffect(() => {
    const edits = trackLexicalEdits(editor);
    tracked.current = edits;
    return () => {
      edits.dispose();
      tracked.current = null;
    };
  }, [editor]);

  return useMemo<SyncedEditor>(() => {
    const edits = () => {
      // Throwing leaves the stored revision unheld, so it is tried again.
      if (!tracked.current) throw new Error("The editor is not mounted.");
      return tracked.current;
    };
    return {
      shows: (elements) => edits().shows(elements),
      hasLocalEdits: () => edits().hasLocalEdits(),
      replace: (revision) => {
        edits().replace(revision);
        onReplace(editor.getEditorState());
      },
      saved: (elements) => tracked.current?.saved(elements),
    };
  }, [editor, onReplace]);
}
