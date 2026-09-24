"use client";

import {
  CLEAR_HISTORY_COMMAND,
  type EditorState,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
} from "lexical";
import { useEffect, useMemo, useRef } from "react";
import type { SyncedEditor } from "~/lib/open-entity-sync";

/**
 * A Lexical editor as `lib/open-entity-sync.ts` sees it.
 *
 * Lexical rewrites a document on its own right after loading it — code
 * highlighting, table column widths — and tags those updates as history
 * merges, which is also how it tells them apart from the user's. So an edit is
 * a content update without that tag, and the serialized state after the last
 * one is what the user made: the same state `OnChangePlugin` hands the save,
 * so a save of it sends exactly this string.
 */
export function useSyncedLexicalEditor(
  editor: LexicalEditor,
  onReplace: (editorState: EditorState) => void,
): SyncedEditor {
  const userState = useRef("");
  const baseline = useRef("");

  // External system: the Lexical editor's update stream.
  useEffect(() => {
    userState.current = JSON.stringify(editor.getEditorState());
    baseline.current = userState.current;
    return editor.registerUpdateListener(
      ({ editorState, dirtyElements, dirtyLeaves, tags }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        if (tags.has(HISTORY_MERGE_TAG)) return;
        userState.current = JSON.stringify(editorState);
      },
    );
  }, [editor]);

  return useMemo<SyncedEditor>(
    () => ({
      shows: (elements) => userState.current === elements,
      hasLocalEdits: () => userState.current !== baseline.current,
      replace: ({ elements }) => {
        const next = editor.parseEditorState(elements);
        onReplace(next);
        editor.setEditorState(next, { tag: HISTORY_MERGE_TAG });
        // Undo must not bring back what the reload replaced.
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
        userState.current = JSON.stringify(editor.getEditorState());
        baseline.current = userState.current;
      },
      saved: (elements) => {
        baseline.current = elements;
      },
    }),
    [editor, onReplace],
  );
}
