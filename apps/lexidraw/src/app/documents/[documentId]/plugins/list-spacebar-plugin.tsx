import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import {
  KEY_SPACE_COMMAND,
  COMMAND_PRIORITY_HIGH,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import { $isListItemNode, $isListNode } from "@lexical/list";

/**
 * This plugin prevents the spacebar from toggling checklist items in Lexical.
 * It checks if the current selection is inside a checklist item and, if so,
 * prevents the default spacebar behavior. Instead, it inserts a space character
 * at the current cursor position.
 */
export function DisableChecklistSpacebarPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_SPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        const anchorNode = selection.anchor.getNode();
        const listItemNode = anchorNode.getParent();

        if ($isListItemNode(listItemNode)) {
          const listNode = listItemNode.getParent();
          if ($isListNode(listNode) && listNode.getListType() === "check") {
            event.preventDefault();

            editor.update(() => {
              const currentSelection = $getSelection();
              if ($isRangeSelection(currentSelection)) {
                currentSelection.insertText(" ");
              }
            });

            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}
