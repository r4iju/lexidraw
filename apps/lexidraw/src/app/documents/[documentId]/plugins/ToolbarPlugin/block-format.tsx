import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  type LucideIcon,
  Pilcrow,
  TextQuote,
} from "lucide-react";
import type { ToggleLevel } from "@packages/lexical-nodes";
import type { TOGGLE_LEVELS } from "@packages/types";
import type { LexicalEditor } from "lexical";
import type { JSX } from "react";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from "~/components/ui/dropdown-menu";
import type { rootTypeToRootName } from "../../context/toolbar-context";
import { formatShortcut, ToolbarMenu } from "./toolbar";
import { useToolbarUtils } from "./utils";

export const BLOCK_TYPES = [
  { type: "paragraph", label: "Normal", icon: Pilcrow, shortcut: "Mod+Alt+0" },
  { type: "h1", label: "Heading 1", icon: Heading1, shortcut: "Mod+Alt+1" },
  { type: "h2", label: "Heading 2", icon: Heading2, shortcut: "Mod+Alt+2" },
  { type: "h3", label: "Heading 3", icon: Heading3, shortcut: "Mod+Alt+3" },
  { type: "h4", label: "Heading 4", icon: Heading4 },
  { type: "bullet", label: "Bulleted list", icon: List, shortcut: "Mod+Alt+4" },
  {
    type: "number",
    label: "Numbered list",
    icon: ListOrdered,
    shortcut: "Mod+Alt+5",
  },
  {
    type: "check",
    label: "Check list",
    icon: ListChecks,
    shortcut: "Mod+Alt+6",
  },
  { type: "toggle", label: "Toggle", icon: ListCollapse, toggle: "paragraph" },
  {
    type: "toggle-h1",
    label: "Toggle heading 1",
    icon: ListCollapse,
    toggle: "h1",
  },
  {
    type: "toggle-h2",
    label: "Toggle heading 2",
    icon: ListCollapse,
    toggle: "h2",
  },
  {
    type: "toggle-h3",
    label: "Toggle heading 3",
    icon: ListCollapse,
    toggle: "h3",
  },
  { type: "quote", label: "Quote", icon: TextQuote, shortcut: "Mod+Alt+Q" },
  { type: "code", label: "Code block", icon: Code, shortcut: "Mod+Alt+C" },
] as const satisfies readonly {
  type: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  /** The level of the toggle's title, for a toggle. */
  toggle?: (typeof TOGGLE_LEVELS)[number];
}[];

export type BlockType = (typeof BLOCK_TYPES)[number]["type"];

/** The level of a toggle's title a block type makes, for toggle types. */
export function toggleLevelOf(type: BlockType | null): ToggleLevel | null {
  const option = BLOCK_TYPES.find((each) => each.type === type);
  return option && "toggle" in option ? option.toggle : null;
}

/** The block type of a toggle whose title is of `level`, if offered. */
export function toggleTypeOf(level: ToggleLevel): BlockType | null {
  return (
    BLOCK_TYPES.find((each) => "toggle" in each && each.toggle === level)
      ?.type ?? null
  );
}

export function useSetBlockType(editor: LexicalEditor, blockType: BlockType) {
  const {
    formatParagraph,
    formatHeading,
    formatBulletList,
    formatNumberedList,
    formatCheckList,
    formatQuote,
    formatCode,
    formatToggle,
    unwrapToggle,
  } = useToolbarUtils();
  const setBlockType = (type: BlockType) => {
    switch (type) {
      case "paragraph":
        return formatParagraph(editor);
      case "h1":
      case "h2":
      case "h3":
      case "h4":
        return formatHeading(editor, blockType, type);
      case "bullet":
        return formatBulletList(editor, blockType);
      case "number":
        return formatNumberedList(editor, blockType);
      case "check":
        return formatCheckList(editor, blockType);
      case "quote":
        return formatQuote(editor, blockType);
      case "code":
        return formatCode(editor, blockType);
      case "toggle":
      case "toggle-h1":
      case "toggle-h2":
      case "toggle-h3":
        return formatToggle(editor, toggleLevelOf(type) ?? "paragraph");
    }
  };
  return (type: BlockType) => {
    // A toggle turned into another kind of block is its title's block first,
    // in the same update, so one undo puts the toggle back.
    if (toggleLevelOf(blockType) && !toggleLevelOf(type))
      editor.update(() => {
        unwrapToggle();
        setBlockType(type);
      });
    else setBlockType(type);
  };
}

/** The block types as menu items, for the toolbar, More and block menus. */
export function BlockTypeItems({
  editor,
  blockType,
  before,
}: {
  editor: LexicalEditor;
  blockType: BlockType | null;
  /** Runs first: puts the selection in the block to change. */
  before?: () => void;
}) {
  const setBlockType = useSetBlockType(editor, blockType ?? "paragraph");
  return (
    <DropdownMenuRadioGroup value={blockType ?? ""}>
      {BLOCK_TYPES.map(({ type, label, icon: Icon, ...rest }) => (
        <DropdownMenuRadioItem
          key={type}
          value={type}
          className="gap-2"
          onSelect={() => {
            before?.();
            setBlockType(type);
          }}
        >
          <Icon className="size-4" />
          {label}
          {"shortcut" in rest && (
            <DropdownMenuShortcut aria-hidden="true">
              {formatShortcut(rest.shortcut).label}
            </DropdownMenuShortcut>
          )}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function blockTypeLabel(blockType: BlockType) {
  return (
    BLOCK_TYPES.find((option) => option.type === blockType) ?? BLOCK_TYPES[0]
  );
}

export function BlockFormatDropDown({
  editor,
  blockType,
  disabled = false,
  className,
}: {
  blockType: BlockType;
  rootType: keyof typeof rootTypeToRootName;
  editor: LexicalEditor;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const { label, icon: Icon } = blockTypeLabel(blockType);
  return (
    <ToolbarMenu
      label="Block type"
      disabled={disabled}
      className={className}
      trigger={
        <>
          <Icon className="shrink-0" />
          {/* A fixed width, so the toolbar doesn't move as the caret does. */}
          <span className="hidden w-24 truncate text-left sm:inline">
            {label}
          </span>
        </>
      }
    >
      <BlockTypeItems editor={editor} blockType={blockType} />
    </ToolbarMenu>
  );
}
