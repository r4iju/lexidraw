import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  NodeContextMenuOption,
  NodeContextMenuPlugin,
  NodeContextMenuSeparator,
} from "@lexical/react/LexicalNodeContextMenuPlugin";
import {
  $getSelection,
  $isRangeSelection,
  COPY_COMMAND,
  CUT_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  PASTE_COMMAND,
} from "lexical";
import { useMemo } from "react";
import type { JSX } from "react";

async function pasteFromClipboard(
  editor: LexicalEditor,
  plainTextOnly: boolean,
): Promise<void> {
  const permission = await navigator.permissions.query({
    // @ts-expect-error These types are incorrect.
    name: "clipboard-read",
  });
  if (permission.state === "denied") {
    alert("Not allowed to paste from clipboard.");
    return;
  }

  const data = new DataTransfer();
  if (plainTextOnly) {
    data.setData("text/plain", await navigator.clipboard.readText());
  } else {
    const item = (await navigator.clipboard.read())[0];
    if (!item) return;
    for (const type of item.types) {
      data.setData(type, await (await item.getType(type)).text());
    }
  }

  editor.dispatchCommand(
    PASTE_COMMAND,
    new ClipboardEvent("paste", { clipboardData: data }),
  );
}

function $isInsideLink(node: LexicalNode): boolean {
  return $isLinkNode(node) || $isLinkNode(node.getParent());
}

export default function ContextMenuPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();

  const items = useMemo(
    () => [
      new NodeContextMenuOption("Copy", {
        $onSelect: () => {
          editor.dispatchCommand(COPY_COMMAND, null);
        },
      }),
      new NodeContextMenuOption("Cut", {
        $onSelect: () => {
          editor.dispatchCommand(CUT_COMMAND, null);
        },
      }),
      new NodeContextMenuOption("Paste", {
        $onSelect: () => {
          void pasteFromClipboard(editor, false);
        },
      }),
      new NodeContextMenuOption("Paste as Plain Text", {
        $onSelect: () => {
          void pasteFromClipboard(editor, true);
        },
      }),
      new NodeContextMenuOption("Delete Node", {
        $onSelect: () => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const currentNode = selection.anchor.getNode();
            const ancestorNodeWithRootAsParent = currentNode
              .getParents()
              .at(-2);

            ancestorNodeWithRootAsParent?.remove();
          }
        },
      }),
      new NodeContextMenuSeparator({ $showOn: $isInsideLink }),
      new NodeContextMenuOption("Remove Link", {
        $showOn: $isInsideLink,
        $onSelect: () => {
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
        },
      }),
    ],
    [editor],
  );

  return (
    <NodeContextMenuPlugin
      items={items}
      className="z-50 w-[200px] list-none outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg elevation-overlay p-1 text-popover-foreground"
      itemClassName="flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled=true]:opacity-50"
      separatorClassName="my-1 h-px bg-border"
    />
  );
}
