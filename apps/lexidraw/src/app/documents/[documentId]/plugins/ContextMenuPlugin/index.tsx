import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COPY_COMMAND,
  CUT_COMMAND,
  type LexicalEditor,
  type NodeKey,
  PASTE_COMMAND,
} from "lexical";
import {
  ClipboardPaste,
  Copy,
  Link,
  MessageSquareText,
  Repeat2,
  Scissors,
  Trash2,
  Type,
} from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { IS_APPLE } from "../../shared/environment";
import { useGetSelectedNode } from "../../utils/getSelectedNode";
import { useSanitizeUrl } from "../../utils/url";
import { INSERT_INLINE_COMMAND } from "../CommentPlugin";
import { $blockTypeOf } from "../ToolbarPlugin/block-actions";
import { deleteBlock } from "../ToolbarPlugin/block-commands";
import { type BlockType, BlockTypeItems } from "../ToolbarPlugin/block-format";
import { formatShortcut } from "../ToolbarPlugin/toolbar";

const PASTE_KEYS = formatShortcut("Mod+V").label;

async function pasteFromClipboard(
  editor: LexicalEditor,
  plainTextOnly: boolean,
): Promise<void> {
  try {
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
  } catch {
    toast.error("The browser didn't allow pasting from the menu", {
      description: `Press ${PASTE_KEYS} to paste instead.`,
    });
  }
}

type Target = {
  x: number;
  y: number;
  blockKey: NodeKey | null;
  blockType: BlockType | null;
  isLink: boolean;
  hasSelection: boolean;
};

function Item({
  icon: Icon,
  shortcut,
  children,
  onSelect,
  disabled,
  className,
}: {
  icon: typeof Copy;
  shortcut?: string;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenuItem
      className={`gap-2 ${className ?? ""}`}
      onSelect={onSelect}
      disabled={disabled}
    >
      <Icon className="size-4" />
      {children}
      {shortcut && (
        <DropdownMenuShortcut aria-hidden="true">
          {formatShortcut(shortcut).label}
        </DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}

/**
 * The editor's own right-click menu. Shift and right-click still opens the
 * browser's, with its spelling suggestions, and on touch the platform's
 * long-press menu is left alone.
 */
export default function ContextMenuPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const getSelectedNode = useGetSelectedNode();
  const sanitizeUrl = useSanitizeUrl();
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.shiftKey || matchMedia("(pointer: coarse)").matches) return;
      event.preventDefault();
      const { clientX: x, clientY: y } = event;
      editor.read(() => {
        const selection = $getSelection();
        const node = $isRangeSelection(selection)
          ? getSelectedNode(selection)
          : selection?.getNodes()[0];
        const block = node?.getTopLevelElement() ?? null;
        setTarget({
          x,
          y,
          blockKey: block?.getKey() ?? null,
          blockType: $blockTypeOf(block),
          isLink:
            !!node && ($isLinkNode(node) || $isLinkNode(node.getParent())),
          hasSelection: !!selection && !selection.isCollapsed(),
        });
      });
    };
    return editor.registerRootListener((root, previous) => {
      previous?.removeEventListener("contextmenu", onContextMenu);
      root?.addEventListener("contextmenu", onContextMenu);
    });
  }, [editor, getSelectedNode]);

  if (!target) return null;
  return (
    <DropdownMenu open onOpenChange={(open) => !open && setTarget(null)}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: target.x, top: target.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="min-w-56">
        <Item
          icon={Scissors}
          shortcut="Mod+X"
          disabled={!target.hasSelection}
          onSelect={() => editor.dispatchCommand(CUT_COMMAND, null)}
        >
          Cut
        </Item>
        <Item
          icon={Copy}
          shortcut="Mod+C"
          disabled={!target.hasSelection}
          onSelect={() => editor.dispatchCommand(COPY_COMMAND, null)}
        >
          Copy
        </Item>
        <Item
          icon={ClipboardPaste}
          shortcut="Mod+V"
          onSelect={() => void pasteFromClipboard(editor, false)}
        >
          Paste
        </Item>
        <Item
          icon={Type}
          shortcut="Mod+Shift+V"
          onSelect={() => void pasteFromClipboard(editor, true)}
        >
          Paste as plain text
        </Item>
        <DropdownMenuSeparator />
        <Item
          icon={MessageSquareText}
          disabled={!target.hasSelection}
          onSelect={() =>
            editor.dispatchCommand(INSERT_INLINE_COMMAND, undefined)
          }
        >
          Comment
        </Item>
        <Item
          icon={Link}
          shortcut="Mod+K"
          onSelect={() =>
            editor.dispatchCommand(
              TOGGLE_LINK_COMMAND,
              target.isLink ? null : sanitizeUrl("https://"),
            )
          }
        >
          {target.isLink ? "Remove link" : "Link…"}
        </Item>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="gap-2"
            disabled={target.blockType === null}
          >
            <Repeat2 className="size-4" />
            Turn into
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-52">
            <BlockTypeItems editor={editor} blockType={target.blockType} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <Item
          icon={Trash2}
          className="text-destructive focus:text-destructive"
          disabled={!target.blockKey}
          onSelect={() => deleteBlock(editor, target.blockKey)}
        >
          Delete block
        </Item>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {IS_APPLE ? "⇧" : "Shift"} + right-click for the browser menu and
          spelling
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
