import {
  ImageNode,
  InlineImageNode,
  StickyNode,
  VideoNode,
} from "@packages/lexical-nodes";
import {
  $getNodeByKey,
  CLEAR_HISTORY_COMMAND,
  COLLABORATION_TAG,
  type EditorState,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  type NodeKey,
  type UpdateListenerPayload,
} from "lexical";
import type { SyncedEditor } from "~/lib/open-entity-sync";

/** The nodes that nest an editor of their own, like an image's caption. */
const CAPTIONED = [ImageNode, InlineImageNode, StickyNode, VideoNode];

/**
 * A Lexical document as `lib/open-entity-sync.ts` sees it.
 *
 * Lexical rewrites a document on its own right after loading it — code
 * highlighting, table column widths — and tags those updates as history
 * merges, which is also how it tells them apart from the user's. So an edit is
 * a content update without that tag, and the document after the last one is
 * what the user made: the same state `OnChangePlugin` hands the save, so a
 * save of it sends exactly its serialization. That is worked out only when
 * asked, not on every keystroke.
 *
 * A collaborator's state arrives whole, tagged as collaboration, and replaces
 * what the user made rather than adding to it.
 *
 * Captions and sticky notes are editors of their own, nested in a node, and
 * the document serializes them with it; so an edit in one is an edit to the
 * whole document.
 */
export function trackLexicalEdits(
  root: LexicalEditor,
): SyncedEditor & { dispose(): void } {
  let userState: EditorState = root.getEditorState();
  /** `userState` serialized, until the next edit anywhere in the document. */
  let serialized: string | null = null;
  const current = () => {
    serialized ??= JSON.stringify(userState);
    return serialized;
  };
  let baseline = current();

  const stop = watch(root, (editor, update) => {
    if (editor === root) userState = update.editorState;
    serialized = null;
    // A collaborator's state, applied live, is theirs, not this user's edit.
    if (update.tags.has(COLLABORATION_TAG)) baseline = current();
  });

  return {
    shows: (elements) => current() === elements,
    hasLocalEdits: () => current() !== baseline,
    replace: ({ elements }) => {
      root.setEditorState(root.parseEditorState(elements), {
        tag: HISTORY_MERGE_TAG,
      });
      // Undo must not bring back what the reload replaced.
      root.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
      userState = root.getEditorState();
      serialized = null;
      baseline = current();
    },
    saved: (elements) => {
      baseline = elements;
      // A save of everything the editor shows took Lexical's own passes on
      // top of the user's edits too; there is nothing of theirs left to save.
      const shown = root.getEditorState();
      if (shown !== userState && JSON.stringify(shown) === elements) {
        userState = shown;
        serialized = elements;
      }
    },
    dispose: stop,
  };
}

/**
 * Calls `onEdit` for the user's edits in `editor` and in every editor nested
 * in its nodes, for as long as each node is there. Answers a stop.
 */
function watch(
  editor: LexicalEditor,
  onEdit: (editor: LexicalEditor, update: UpdateListenerPayload) => void,
): () => void {
  const nested = new Map<NodeKey, { editor: LexicalEditor; stop(): void }>();
  const letGo = (key: NodeKey) => {
    nested.get(key)?.stop();
    nested.delete(key);
  };
  const stops = [
    editor.registerUpdateListener((update) => {
      if (isEdit(update)) onEdit(editor, update);
    }),
    ...CAPTIONED.filter((klass) => editor.hasNodes([klass])).map((klass) =>
      editor.registerMutationListener(klass, (mutations) => {
        for (const [key, mutation] of mutations) {
          if (mutation === "destroyed") {
            letGo(key);
            continue;
          }
          const caption = editor
            .getEditorState()
            .read(() => captionOf($getNodeByKey(key)));
          if (nested.get(key)?.editor === caption) continue;
          letGo(key);
          if (caption)
            nested.set(key, { editor: caption, stop: watch(caption, onEdit) });
        }
      }),
    ),
  ];
  return () => {
    for (const stop of stops) stop();
    for (const key of [...nested.keys()]) letGo(key);
  };
}

function captionOf(node: unknown): LexicalEditor | null {
  if (!CAPTIONED.some((klass) => node instanceof klass)) return null;
  const caption: unknown = (node as { __caption?: unknown }).__caption;
  return isEditor(caption) ? caption : null;
}

function isEditor(value: unknown): value is LexicalEditor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LexicalEditor).registerUpdateListener === "function"
  );
}

function isEdit({ dirtyElements, dirtyLeaves, tags }: UpdateListenerPayload) {
  if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return false;
  return !tags.has(HISTORY_MERGE_TAG);
}
