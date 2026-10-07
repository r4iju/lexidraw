import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  type EditorState,
  type NodeKey,
} from "lexical";
import { useEffect } from "react";

/**
 * A sticky note or a poll is a block inside the paragraph that holds it, and
 * document.css hides the empty line Lexical keeps after a paragraph's last
 * decorator. While the caret sits right after this block at the end of its
 * paragraph, the paragraph is marked `data-caret-after`, so that line shows
 * and the caret is drawn where typing will go.
 */
export function useCaretLine(nodeKey: NodeKey): void {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    let marked: HTMLElement | null = null;
    const mark = (state: EditorState) => {
      const paragraph = state.read(() => {
        const node = $getNodeByKey(nodeKey);
        const parent = node?.getParent();
        const selection = $getSelection();
        if (
          !node ||
          !parent ||
          node.getNextSibling() ||
          !$isRangeSelection(selection) ||
          !selection.isCollapsed()
        )
          return null;
        const { anchor } = selection;
        return anchor.type === "element" &&
          anchor.key === parent.getKey() &&
          anchor.offset === parent.getChildrenSize()
          ? parent.getKey()
          : null;
      });
      const element = paragraph ? editor.getElementByKey(paragraph) : null;
      if (element === marked) return;
      marked?.removeAttribute("data-caret-after");
      element?.setAttribute("data-caret-after", "");
      marked = element;
    };
    mark(editor.getEditorState());
    const stop = editor.registerUpdateListener(({ editorState }) =>
      mark(editorState),
    );
    return () => {
      stop();
      marked?.removeAttribute("data-caret-after");
    };
  }, [editor, nodeKey]);
}
