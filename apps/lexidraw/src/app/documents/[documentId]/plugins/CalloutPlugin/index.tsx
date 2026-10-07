import { copyToClipboard } from "@lexical/clipboard";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $insertNodeToNearestRoot, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  CUT_COMMAND,
  createCommand,
  DELETE_CHARACTER_COMMAND,
  type ElementNode,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalCommand,
  type RangeSelection,
  REMOVE_TEXT_COMMAND,
} from "lexical";
import { useEffect } from "react";
import {
  $calloutOf,
  $isTextBlock,
  $joinBlocks,
  $removeAcrossCallouts,
  $topBlockOf,
  $unwrapCallout,
  CalloutNode,
  type CalloutKind,
} from "@packages/lexical-nodes";

export const INSERT_CALLOUT_COMMAND: LexicalCommand<{
  kind: CalloutKind;
  title?: string;
}> = createCommand("INSERT_CALLOUT_COMMAND");

/** The selection, when it is a caret. */
function $caret(): RangeSelection | null {
  const selection = $getSelection();
  return $isRangeSelection(selection) && selection.isCollapsed()
    ? selection
    : null;
}

const $caretCallout = () => {
  const selection = $caret();
  const callout = selection && $calloutOf(selection.anchor.getNode());
  return selection && callout ? { selection, callout } : null;
};

/** Whether the caret is at the very start of `node`'s first line. */
const $atStart = ({ anchor }: RangeSelection, node: ElementNode) =>
  anchor.offset === 0 &&
  (anchor.key === node.getKey() ||
    anchor.key === node.getFirstDescendant()?.getKey());

/**
 * Backspace at the very start of a callout turns it back into the blocks it
 * held, as Notion's does. At the start of a line just after a callout it
 * joins the line onto the callout's last, as it joins two paragraphs.
 */
function $backspace() {
  const selection = $caret();
  if (!selection) return false;
  const callout = $calloutOf(selection.anchor.getNode());
  if (callout && $atStart(selection, callout)) {
    $unwrapCallout(callout);
    return true;
  }
  const block = $topBlockOf(selection.anchor.getNode());
  const previous = block?.getPreviousSibling();
  if (
    !$isTextBlock(block) ||
    block.isEmpty() ||
    !CalloutNode.$isCalloutNode(previous) ||
    !$atStart(selection, block)
  )
    return false;
  const last = previous.getLastChild();
  if ($isTextBlock(last)) $joinBlocks(last, block);
  else previous.append(block);
  return true;
}

/** Whether the caret is at the very end of `node`'s last line. */
function $atEnd({ anchor }: RangeSelection, node: ElementNode) {
  if (anchor.key === node.getKey())
    return anchor.offset === node.getChildrenSize();
  const last = node.getLastDescendant();
  return (
    anchor.key === last?.getKey() && anchor.offset === last.getTextContentSize()
  );
}

/**
 * Delete mirrors Backspace: at the end of a line just before a callout it
 * pulls the callout's first line up, taking the callout away with it when
 * that was all it held; at the end of a callout's last line it pulls the
 * next line in.
 */
function $forwardDelete() {
  const selection = $caret();
  if (!selection) return false;
  const block = $topBlockOf(selection.anchor.getNode());
  if (!$isTextBlock(block) || block.isEmpty() || !$atEnd(selection, block))
    return false;
  const next = block.getNextSibling();
  if (CalloutNode.$isCalloutNode(next)) {
    const first = next.getFirstChild();
    if (!$isTextBlock(first)) return false;
    $joinBlocks(block, first);
    if (next.isEmpty()) next.remove();
    return true;
  }
  const callout = block.getParent();
  const after = callout?.getNextSibling();
  if (
    !CalloutNode.$isCalloutNode(callout) ||
    block.getNextSibling() !== null ||
    !$isTextBlock(after) ||
    after.isEmpty()
  )
    return false;
  $joinBlocks(block, after);
  return true;
}

export default function CalloutPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([CalloutNode])) {
      throw new Error("CalloutPlugin: CalloutNode not registered on editor");
    }

    // A callout that opens or closes the document leaves no line to put the
    // caret on beside it, so arrowing out of it makes one.
    const $escape = (before: boolean) => {
      const found = $caretCallout();
      if (!found) return false;
      const { selection, callout } = found;
      const edge = before
        ? callout.getFirstDescendant()
        : callout.getLastDescendant();
      const atEdge =
        edge !== null &&
        selection.anchor.key === edge.getKey() &&
        selection.anchor.offset === (before ? 0 : edge.getTextContentSize());
      const sibling = before
        ? callout.getPreviousSibling()
        : callout.getNextSibling();
      if (!atEdge || sibling !== null) return false;
      const paragraph = $createParagraphNode();
      if (before) callout.insertBefore(paragraph);
      else callout.insertAfter(paragraph);
      return false;
    };

    return mergeRegister(
      editor.registerCommand(
        INSERT_CALLOUT_COMMAND,
        ({ kind, title = "" }) => {
          const paragraph = $createParagraphNode();
          const callout = CalloutNode.$createCalloutNode(kind, title.trim());
          $insertNodeToNearestRoot(callout.append(paragraph));
          const after = callout.getNextSibling();
          if (
            $isParagraphNode(after) &&
            after.isEmpty() &&
            after.getNextSibling() !== null
          ) {
            after.remove();
          }
          paragraph.select();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),

      // Enter on an empty last line leaves the callout, as it leaves a list.
      editor.registerCommand(
        INSERT_PARAGRAPH_COMMAND,
        () => {
          const found = $caretCallout();
          if (!found) return false;
          const { selection, callout } = found;
          const line = selection.anchor.getNode();
          if (
            !$isParagraphNode(line) ||
            !line.isEmpty() ||
            line.getParent() !== callout ||
            line.getNextSibling() !== null ||
            line.getPreviousSibling() === null
          ) {
            return false;
          }
          callout.insertAfter(line);
          line.select();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),

      editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (isBackward) =>
          $removeAcrossCallouts() ||
          (isBackward ? $backspace() : $forwardDelete()),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        REMOVE_TEXT_COMMAND,
        $removeAcrossCallouts,
        COMMAND_PRIORITY_LOW,
      ),
      // What is typed goes in where the selection was, once it is removed.
      editor.registerCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        () => {
          $removeAcrossCallouts();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      // Rich text's cut removes the selection itself, after copying it.
      editor.registerCommand(
        CUT_COMMAND,
        (event) => {
          const selection = $getSelection();
          if (
            !$isRangeSelection(selection) ||
            selection.isCollapsed() ||
            $calloutOf(selection.anchor.getNode())?.getKey() ===
              $calloutOf(selection.focus.getNode())?.getKey()
          )
            return false;
          void copyToClipboard(
            editor,
            event instanceof ClipboardEvent ? event : null,
          ).then(() => editor.update($removeAcrossCallouts));
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),

      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => $escape(false),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        () => $escape(true),
        COMMAND_PRIORITY_LOW,
      ),

      editor.registerNodeTransform(CalloutNode, (callout) => {
        if (callout.isEmpty()) {
          callout.append($createParagraphNode());
        }
      }),
    );
  }, [editor]);

  return null;
}
