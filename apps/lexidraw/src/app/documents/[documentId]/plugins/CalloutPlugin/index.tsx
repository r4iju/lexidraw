import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $findMatchingParent,
  $insertNodeToNearestRoot,
  mergeRegister,
} from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  createCommand,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalCommand,
} from "lexical";
import { useEffect } from "react";
import { CalloutNode, type CalloutKind } from "@packages/lexical-nodes";

export const INSERT_CALLOUT_COMMAND: LexicalCommand<{
  kind: CalloutKind;
  title?: string;
}> = createCommand("INSERT_CALLOUT_COMMAND");

const $caretCallout = () => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const callout = $findMatchingParent(
    selection.anchor.getNode(),
    CalloutNode.$isCalloutNode,
  );
  return callout ? { selection, callout } : null;
};

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
