import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  DELETE_CHARACTER_COMMAND,
  type EditorState,
  type ElementNode,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { useEffect } from "react";

import {
  $createToggle,
  $repairToggle,
  $repairToggleContent,
  $repairToggleTitle,
  $toggleContent,
  $toggleLevel,
  $toggleOfTitle,
  $toggleTitleBlock,
  $unwrapToggle,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  type ToggleLevel,
} from "@packages/lexical-nodes";

/** Inserts a toggle, its title a block of the level given (a paragraph). */
export const INSERT_COLLAPSIBLE_COMMAND = createCommand<
  ToggleLevel | undefined
>();

const { $isCollapsibleContainerNode } = CollapsibleContainerNode;

/** The selection, when it is a caret. */
function $caret(): RangeSelection | null {
  const selection = $getSelection();
  return $isRangeSelection(selection) && selection.isCollapsed()
    ? selection
    : null;
}

/** The block holding the caret, the nearest under a root or shadow root. */
function $caretBlock(selection: RangeSelection): ElementNode | null {
  const block = $findMatchingParent(selection.anchor.getNode(), (node) => {
    const parent = node.getParent();
    return parent !== null && $isRootOrShadowRoot(parent);
  });
  return $isElementNode(block) ? block : null;
}

function $atStart(selection: RangeSelection, block: ElementNode) {
  const { anchor } = selection;
  if (anchor.offset !== 0) return false;
  const first = block.getFirstDescendant();
  return anchor.getNode().is(block) || anchor.getNode().is(first);
}

function $atEnd(selection: RangeSelection, block: ElementNode) {
  const { anchor } = selection;
  const last = block.getLastDescendant();
  if (anchor.getNode().is(block))
    return anchor.offset === block.getChildrenSize();
  return (
    anchor.getNode().is(last) &&
    anchor.offset === anchor.getNode().getTextContentSize()
  );
}

/** The caret's toggle, when the caret is in that toggle's title. */
function $titleCaret() {
  const selection = $caret();
  if (!selection) return null;
  const container = $toggleOfTitle(selection.anchor.getNode());
  const block = container && $toggleTitleBlock(container);
  return container && block ? { selection, container, block } : null;
}

/** The outermost closed toggle whose content holds `node`. */
function $closedToggleAround(node: LexicalNode) {
  let closed: CollapsibleContainerNode | null = null;
  for (let at = node.getParent(); at; at = at.getParent()) {
    if (
      CollapsibleContentNode.$isCollapsibleContentNode(at) &&
      $isCollapsibleContainerNode(at.getParent())
    ) {
      const container = at.getParent() as CollapsibleContainerNode;
      if (!container.getOpen()) closed = container;
    }
  }
  return closed;
}

/** Puts the caret at the start of what follows `container`, making a line. */
function $selectAfter(container: CollapsibleContainerNode) {
  const next = container.getNextSibling();
  if ($isElementNode(next)) next.selectStart();
  else {
    const paragraph = $createParagraphNode();
    container.insertAfter(paragraph);
    paragraph.select();
  }
}

/** Puts the caret on an empty line at the top of a toggle's content. */
function $selectContentStart(container: CollapsibleContainerNode) {
  const content = $toggleContent(container);
  if (!content) return;
  const first = content.getFirstChild();
  if ($isParagraphNode(first) && first.isEmpty()) first.select();
  else {
    const paragraph = $createParagraphNode();
    if (first) first.insertBefore(paragraph);
    else content.append(paragraph);
    paragraph.select();
  }
}

export default function CollapsiblePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (
      !editor.hasNodes([
        CollapsibleContainerNode,
        CollapsibleTitleNode,
        CollapsibleContentNode,
      ])
    ) {
      throw new Error(
        "CollapsiblePlugin: CollapsibleContainerNode, CollapsibleTitleNode, or CollapsibleContentNode not registered on editor",
      );
    }

    /**
     * The caret never rests in content that is folded away: moving into it
     * from the title goes past the toggle, and from anywhere else (below,
     * or inside it as it closes) to the end of the title.
     */
    const keepCaretInSight = ({
      editorState,
      prevEditorState,
    }: {
      editorState: EditorState;
      prevEditorState: EditorState;
    }) => {
      const hidden = editorState.read(() => {
        const selection = $caret();
        const container =
          selection && $closedToggleAround(selection.anchor.getNode());
        return container?.getKey() ?? null;
      });
      if (!hidden) return;
      const fromTitle = prevEditorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        return $toggleOfTitle(selection.anchor.getNode())?.getKey() === hidden;
      });
      editor.update(() => {
        const node = $closedToggleAroundKey(hidden);
        if (!node) return;
        if (fromTitle) $selectAfter(node);
        else $toggleTitleBlock(node)?.selectEnd();
      });
    };

    return mergeRegister(
      editor.registerNodeTransform(CollapsibleContainerNode, $repairToggle),
      editor.registerNodeTransform(CollapsibleTitleNode, $repairToggleTitle),
      editor.registerNodeTransform(
        CollapsibleContentNode,
        $repairToggleContent,
      ),
      editor.registerUpdateListener(keepCaretInSight),

      // Cmd/Ctrl+Enter in a title opens or closes its toggle.
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || !(event.metaKey || event.ctrlKey)) return false;
          const caret = $titleCaret();
          if (!caret) return false;
          event.preventDefault();
          caret.container.toggleOpen();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),

      /**
       * Enter at the end of a title goes into the toggle, opening it; on a
       * closed toggle that holds something it starts the next toggle
       * instead, so a list of them is written line by line. At the start of
       * a title it opens a line above the toggle. Elsewhere in a title it
       * splits as usual, and what follows the caret becomes the content's
       * first line.
       */
      editor.registerCommand(
        INSERT_PARAGRAPH_COMMAND,
        () => {
          const caret = $titleCaret();
          if (!caret) return false;
          const { selection, container, block } = caret;
          const content = $toggleContent(container);
          if (!block.isEmpty() && $atStart(selection, block)) {
            container.insertBefore($createParagraphNode());
            return true;
          }
          if (!$atEnd(selection, block)) {
            return false;
          }
          if (
            !container.getOpen() &&
            content &&
            content.getTextContent().trim() !== ""
          ) {
            const next = $createToggle($toggleLevel(container));
            container.insertAfter(next.container);
            next.titleBlock.select();
            return true;
          }
          container.setOpen(true);
          $selectContentStart(container);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),

      /**
       * Backspace at the start of a title turns the toggle back into its
       * title's block followed by what it held. At the start of a block
       * after a closed toggle it opens the toggle rather than reach into
       * content that is out of sight.
       */
      editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (isBackward) => {
          if (!isBackward) return false;
          const caret = $titleCaret();
          if (caret) {
            if (!$atStart(caret.selection, caret.block)) return false;
            $unwrapToggle(caret.container)?.selectStart();
            return true;
          }
          const selection = $caret();
          const block = selection && $caretBlock(selection);
          if (!selection || !block || !$atStart(selection, block)) return false;
          const previous = block.getPreviousSibling();
          if (!$isCollapsibleContainerNode(previous) || previous.getOpen())
            return false;
          previous.setOpen(true);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),

      // A toggle last in the document always has a line after it to move
      // on to, and one first in it a line before it.
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        $escapeDown,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        $escapeDown,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        $escapeUp,
        COMMAND_PRIORITY_LOW,
      ),

      editor.registerCommand(
        INSERT_COLLAPSIBLE_COMMAND,
        (level) => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          const { container, titleBlock } = $createToggle(level, true);
          const block = $caretBlock(selection);
          if (!block) return false;
          // An empty line becomes the toggle; otherwise it goes after the
          // line, as Notion's does.
          if ($isParagraphNode(block) && block.isEmpty())
            block.replace(container);
          else block.insertAfter(container);
          titleBlock.select();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  return null;
}

function $closedToggleAroundKey(key: string) {
  const selection = $caret();
  const container =
    selection && $closedToggleAround(selection.anchor.getNode());
  return container?.getKey() === key ? container : null;
}

/** The toggle holding the caret, when the caret is at its very end. */
function $atToggleEnd(selection: RangeSelection) {
  const block = $caretBlock(selection);
  if (!block || !$atEnd(selection, block)) return null;
  for (let at: LexicalNode | null = block; at; at = at.getParent()) {
    const container = at.getParent();
    if (!$isCollapsibleContainerNode(container)) continue;
    const content = $toggleContent(container);
    const last = container.getOpen()
      ? content?.getLastChild()
      : $toggleTitleBlock(container);
    return last?.is(block) ? container : null;
  }
  return null;
}

function $escapeDown() {
  const selection = $caret();
  const container = selection && $atToggleEnd(selection);
  if (container && container.getNextSibling() === null)
    container.insertAfter($createParagraphNode());
  return false;
}

function $escapeUp() {
  const caret = $titleCaret();
  if (
    caret &&
    $atStart(caret.selection, caret.block) &&
    caret.container.getPreviousSibling() === null
  )
    caret.container.insertBefore($createParagraphNode());
  return false;
}
