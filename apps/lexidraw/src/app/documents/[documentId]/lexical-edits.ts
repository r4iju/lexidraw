import { $dfs } from "@lexical/utils";
import {
  CLEAR_HISTORY_COMMAND,
  type EditorState,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  type UpdateListenerPayload,
} from "lexical";
import type { SyncedEditor } from "~/lib/open-entity-sync";

/**
 * A Lexical document as `lib/open-entity-sync.ts` sees it.
 *
 * Lexical rewrites a document on its own right after loading it — code
 * highlighting, table column widths — and tags those updates as history
 * merges, which is also how it tells them apart from the user's. So an edit is
 * a content update without that tag, and the serialized document after the
 * last one is what the user made: the same state `OnChangePlugin` hands the
 * save, so a save of it sends exactly this string.
 *
 * Captions and sticky notes are editors of their own, nested in a node, and
 * the document serializes them with it; so an edit in one re-reads the whole
 * document too.
 */
export function trackLexicalEdits(
  root: LexicalEditor,
): SyncedEditor & { dispose(): void } {
  // Called from an effect; see `fingerprint` in `use-synced-excalidraw.ts`.
  "use no memo";
  const serialize = () => JSON.stringify(root.getEditorState());
  let userState = serialize();
  let baseline = userState;

  const watched = new Map<LexicalEditor, () => void>();
  const watchNested = (state: EditorState) => {
    for (const nested of nestedEditors(state)) {
      if (!watched.has(nested)) watch(nested);
    }
  };
  const watch = (editor: LexicalEditor) => {
    watched.set(
      editor,
      editor.registerUpdateListener((update) => {
        watchNested(update.editorState);
        if (isEdit(update)) userState = serialize();
      }),
    );
    watchNested(editor.getEditorState());
  };
  watch(root);

  return {
    shows: (elements) => userState === elements,
    hasLocalEdits: () => userState !== baseline,
    replace: ({ elements }) => {
      root.setEditorState(root.parseEditorState(elements), {
        tag: HISTORY_MERGE_TAG,
      });
      // Undo must not bring back what the reload replaced.
      root.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
      userState = serialize();
      baseline = userState;
    },
    saved: (elements) => {
      baseline = elements;
    },
    dispose: () => {
      for (const stop of watched.values()) stop();
      watched.clear();
    },
  };
}

/** The editors nested in a state's nodes, like an image's caption. */
function nestedEditors(state: EditorState): LexicalEditor[] {
  "use no memo";
  return state.read(() =>
    $dfs().flatMap(({ node }) => {
      // The nodes that nest an editor share no class, only this field.
      const nested: unknown = (node as { __caption?: unknown }).__caption;
      return isEditor(nested) ? [nested] : [];
    }),
  );
}

function isEditor(value: unknown): value is LexicalEditor {
  "use no memo";
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LexicalEditor).registerUpdateListener === "function"
  );
}

function isEdit({ dirtyElements, dirtyLeaves, tags }: UpdateListenerPayload) {
  "use no memo";
  if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return false;
  return !tags.has(HISTORY_MERGE_TAG);
}
