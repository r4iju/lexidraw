import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNaturalSize,
  $setNaturalSize,
  type NaturalSize,
} from "@packages/lexical-nodes";
import { $getNodeByKey, HISTORY_MERGE_TAG, type NodeKey } from "lexical";
import { useCallback } from "react";

/**
 * Tags an update storing what a block measured as it was drawn. It is no
 * undo step and not the user's edit, so it neither marks the document unsaved
 * nor makes a newer copy elsewhere a question; it goes out with the next
 * save, which auto-save makes straight away.
 */
export const MEASURED_TAG = "measured";

/**
 * Keeps the natural size a block was drawn at, when it has changed; with
 * `replace: false`, only when it has none.
 */
export function useKeepNaturalSize(
  nodeKey: NodeKey,
  { replace = true }: { replace?: boolean } = {},
) {
  const [editor] = useLexicalComposerContext();
  return useCallback(
    (size: NaturalSize) => {
      const same = editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey);
        if (!node) return true;
        const kept = $getNaturalSize(node);
        return (
          kept !== undefined &&
          (!replace ||
            (kept.width === size.width && kept.height === size.height))
        );
      });
      if (same) return;
      editor.update(
        () => {
          const node = $getNodeByKey(nodeKey);
          if (node) $setNaturalSize(node, size);
        },
        { tag: [HISTORY_MERGE_TAG, MEASURED_TAG] },
      );
    },
    [editor, nodeKey, replace],
  );
}
