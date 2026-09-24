import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type NodeKey,
} from "lexical";
import { ScissorsIcon } from "lucide-react";
import { useCallback, useEffect } from "react";
import { cn } from "~/lib/utils";
import { PageBreakNode } from "./index";

export default function PageBreakComponent({ nodeKey }: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);

  const $onDelete = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      if (isSelected && $isNodeSelection($getSelection())) {
        const node = $getNodeByKey(nodeKey);
        if (PageBreakNode.$isPageBreakNode(node)) {
          node.remove();
          return true;
        }
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          const pbElem = editor.getElementByKey(nodeKey);

          if (
            isEditable &&
            event.target instanceof Node &&
            pbElem?.contains(event.target)
          ) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [
    clearSelection,
    editor,
    isEditable,
    isSelected,
    nodeKey,
    $onDelete,
    setSelected,
  ]);

  useEffect(() => {
    const pbElem = editor.getElementByKey(nodeKey);
    if (pbElem !== null) {
      pbElem.classList.toggle("document-page-break-selected", isSelected);
    }
  }, [editor, isSelected, nodeKey]);

  // The node's own element carries the break, so a reader and paper get the
  // break without the marker that shows an editor where it is.
  if (!isEditable) return null;

  return (
    <figure
      data-node-type="page-break"
      className={cn(
        "relative block border-y border-muted border-dashed print:hidden",
        "bg-muted border-muted",
        "w-full",
        "my-[1rem]",
        isSelected && "border-primary",
      )}
    >
      <ScissorsIcon
        className={cn(
          "absolute left-3",
          "top-1/2 -translate-y-1/2 h-4 w-4 opacity-50",
          isSelected && "opacity-100",
        )}
      />

      <span className="absolute inset-0 flex items-center justify-center">
        <span className="border px-1.5 py-0.5 text-xs font-semibold bg-background text-muted-foreground border-muted cursor-default">
          PAGE&nbsp;BREAK
        </span>
      </span>
    </figure>
  );
}
