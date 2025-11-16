"use client";

export type DocumentJson = unknown;

type LexicalEditorLike = {
  update: (fn: () => void) => void;
};

/**
 * Export your Lexical editor state to a JSON representation suitable for
 * sandboxed processing. Implementers should transform the current editor
 * state into a structure that contains no secrets and no DOM references.
 */
export function exportLexicalToJson(
  getEditorStateSnapshot: () => unknown,
): DocumentJson {
  // The caller provides an editor-state snapshot function to avoid importing Lexical here.
  // Ensure the returned data is serializable and contains no secret values.
  return getEditorStateSnapshot();
}

/**
 * Apply a sandbox-produced document JSON back into Lexical.
 * This is intentionally minimal; implementers should provide the mapping logic
 * that converts DocumentJson into Lexical nodes and state transitions.
 */
export function importJsonIntoLexical(
  newDoc: DocumentJson,
  editor: LexicalEditorLike,
): void {
  editor.update(() => {
    // Intentionally left as a no-op placeholder.
    // Map `newDoc` into Lexical nodes here in your app code.
  });
}
