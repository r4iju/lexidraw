import { $patchStyleText } from "@lexical/selection";
import {
  $getSelection,
  type ElementFormatType,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  REDO_COMMAND,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import {
  ArrowDown,
  ArrowUp,
  Baseline,
  Bold,
  Code,
  CopyPlus,
  Highlighter,
  Italic,
  Keyboard,
  Link,
  List,
  ListChecks,
  MessageSquarePlus,
  Plus,
  Redo,
  Repeat2,
  Search,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ColorPickerButton,
  HIGHLIGHT_PRESETS,
  TEXT_COLOUR_PRESETS,
} from "~/components/ui/color-picker";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { INSERT_INLINE_COMMAND } from "../CommentPlugin";
import { TableBarItems } from "../TableActionMenuPlugin";
import { AiMenu } from "./ai-menu";
import { $barMode, type BarMode } from "./bar-mode";
import { deleteBlock, duplicateBlock, moveBlock } from "./block-commands";
import {
  type BlockType,
  BlockTypeItems,
  useSetBlockType,
} from "./block-format";
import { AlignItems } from "./element-format";
import { FontItems } from "./font";
import { InsertItems, type ShowModal } from "./insert-item";
import { ColourItems, MoreSub } from "./menu-parts";
import { ToolbarButton, ToolbarMenu } from "./toolbar";

const SIZES = [12, 14, 16, 18, 20, 24, 30, 36];

type PhoneBarProps = {
  editor: LexicalEditor;
  formats: Set<TextFormatType>;
  inCode: boolean;
  isLink: boolean;
  toggleLink: () => void;
  blockType: BlockType;
  canUndo: boolean;
  canRedo: boolean;
  fontValue: string;
  fontSize: string;
  fontColor: string;
  bgColor: string;
  onFontColorSelect: (value: string, skipHistoryStack: boolean) => void;
  onBgColorSelect: (value: string, skipHistoryStack: boolean) => void;
  elementFormat: ElementFormatType;
  isRTL: boolean;
  signedIn: boolean;
  showModal: ShowModal;
};

/**
 * A phone's formatting, in one row above the keyboard and the home indicator
 * that scrolls sideways. What it offers follows the selection: writing tools,
 * formatting for selected text, a table cell's actions or a block's.
 */
export function PhoneBar(props: PhoneBarProps) {
  const { editor } = props;
  const bar = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<BarMode>("default");

  useEffect(() => {
    const read = () => {
      const next = editor.getEditorState().read($barMode);
      if (next) setMode(next);
    };
    read();
    return editor.registerUpdateListener(read);
  }, [editor]);

  // External system: the page, which keeps its end clear of the bar, and
  // toasts, which sit above it.
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty(
        "--bottom-bar-height",
        `${element.getBoundingClientRect().height}px`,
      ),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bottom-bar-height");
    };
  }, []);

  return createPortal(
    <div
      ref={bar}
      role="toolbar"
      aria-label={BAR_LABELS[mode]}
      data-bar-mode={mode}
      // A tap keeps the caret, and the keyboard, where they are.
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("button"))
          event.preventDefault();
      }}
      className="fixed inset-x-0 bottom-(--keyboard-inset) z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] print:hidden"
    >
      <div className="flex h-11 items-center gap-0.5 overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]">
        {mode === "selection" && <SelectionItems {...props} />}
        {mode === "table" && <TableBarItems />}
        {mode === "block" && <BlockItems {...props} />}
        {mode === "default" && <DefaultItems {...props} />}
      </div>
    </div>,
    document.body,
  );
}

const BAR_LABELS: Record<BarMode, string> = {
  default: "Formatting",
  selection: "Selected text",
  table: "Table cell",
  block: "Block",
};

function Mark({
  format,
  label,
  icon,
  editor,
  formats,
  inCode,
}: {
  format: TextFormatType;
  label: string;
  icon: typeof Bold;
} & Pick<PhoneBarProps, "editor" | "formats" | "inCode">) {
  return (
    <ToolbarButton
      label={label}
      icon={icon}
      pressed={formats.has(format)}
      disabled={inCode}
      onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
    />
  );
}

function CommentButton({ editor }: { editor: LexicalEditor }) {
  return (
    <ToolbarButton
      label="Comment"
      icon={MessageSquarePlus}
      onClick={() => editor.dispatchCommand(INSERT_INLINE_COMMAND, undefined)}
    />
  );
}

function LinkButton({
  isLink,
  inCode,
  toggleLink,
}: Pick<PhoneBarProps, "isLink" | "inCode" | "toggleLink">) {
  return (
    <ToolbarButton
      label="Link"
      icon={Link}
      pressed={isLink}
      disabled={inCode}
      onClick={toggleLink}
    />
  );
}

function DefaultItems(props: PhoneBarProps) {
  const { editor, blockType, canUndo, canRedo, showModal } = props;
  const setBlockType = useSetBlockType(editor, blockType);
  return (
    <>
      <TextSheet {...props} />
      <Mark {...props} format="bold" label="Bold" icon={Bold} />
      <Mark {...props} format="italic" label="Italic" icon={Italic} />
      <ToolbarButton
        label="Bulleted list"
        icon={List}
        pressed={blockType === "bullet"}
        onClick={() => setBlockType("bullet")}
      />
      <ToolbarButton
        label="Checklist"
        icon={ListChecks}
        pressed={blockType === "check"}
        onClick={() => setBlockType("check")}
      />
      <LinkButton {...props} />
      <InsertSheet editor={editor} showModal={showModal} />
      <CommentButton editor={editor} />
      <ToolbarButton
        label="Undo"
        icon={Undo}
        disabled={!canUndo}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      />
      <ToolbarButton
        label="Redo"
        icon={Redo}
        disabled={!canRedo}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      />
      <ToolbarButton
        label="Hide keyboard"
        icon={Keyboard}
        onClick={() => {
          editor.blur();
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      />
    </>
  );
}

function SelectionItems(props: PhoneBarProps) {
  const { editor, inCode, bgColor, onBgColorSelect, signedIn } = props;
  return (
    <>
      <Mark {...props} format="bold" label="Bold" icon={Bold} />
      <Mark {...props} format="italic" label="Italic" icon={Italic} />
      <Mark {...props} format="underline" label="Underline" icon={Underline} />
      <Mark
        {...props}
        format="strikethrough"
        label="Strikethrough"
        icon={Strikethrough}
      />
      <Mark {...props} format="code" label="Inline code" icon={Code} />
      <LinkButton {...props} />
      <ColorPickerButton
        title="Highlight"
        color={bgColor}
        presets={HIGHLIGHT_PRESETS}
        onChange={onBgColorSelect}
        Icon={Highlighter}
        disabled={inCode}
      />
      <CommentButton editor={editor} />
      {signedIn && <AiMenu />}
    </>
  );
}

function BlockItems({ editor, blockType }: PhoneBarProps) {
  return (
    <>
      <ToolbarMenu label="Turn into" icon={Repeat2} trigger="Turn into">
        <BlockTypeItems editor={editor} blockType={blockType} />
      </ToolbarMenu>
      <ToolbarButton
        label="Move up"
        icon={ArrowUp}
        onClick={() => moveBlock(editor, "up")}
      />
      <ToolbarButton
        label="Move down"
        icon={ArrowDown}
        onClick={() => moveBlock(editor, "down")}
      />
      <ToolbarButton
        label="Duplicate"
        icon={CopyPlus}
        onClick={() => duplicateBlock(editor)}
      />
      <ToolbarButton
        label="Delete block"
        icon={Trash2}
        className="text-destructive"
        onClick={() => deleteBlock(editor)}
      />
    </>
  );
}

/** Aa: how the text looks, one sheet deep for each. */
function TextSheet({
  editor,
  blockType,
  fontValue,
  fontSize,
  fontColor,
  bgColor,
  onFontColorSelect,
  onBgColorSelect,
  elementFormat,
  isRTL,
  inCode,
  showModal,
}: PhoneBarProps) {
  const size = Number.parseInt(fontSize, 10);
  return (
    <ToolbarMenu label="Text" icon={Type}>
      <MoreSub label="Block type">
        <BlockTypeItems editor={editor} blockType={blockType} />
      </MoreSub>
      <MoreSub label="Font" disabled={inCode}>
        <FontItems editor={editor} value={fontValue} showModal={showModal} />
      </MoreSub>
      <MoreSub label="Size" disabled={inCode}>
        <DropdownMenuRadioGroup
          value={String(size)}
          onValueChange={(next) =>
            editor.update(() => {
              const selection = $getSelection();
              if (selection)
                $patchStyleText(selection, { "font-size": `${next}px` });
            })
          }
        >
          {SIZES.map((option) => (
            <DropdownMenuRadioItem key={option} value={String(option)}>
              {option}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </MoreSub>
      <MoreSub label="Text colour" icon={Baseline} disabled={inCode}>
        <ColourItems
          value={fontColor}
          presets={TEXT_COLOUR_PRESETS}
          onChange={onFontColorSelect}
        />
      </MoreSub>
      <MoreSub label="Highlight" icon={Highlighter} disabled={inCode}>
        <ColourItems
          value={bgColor}
          presets={HIGHLIGHT_PRESETS}
          onChange={onBgColorSelect}
        />
      </MoreSub>
      <MoreSub label="Align">
        <AlignItems editor={editor} value={elementFormat} isRTL={isRTL} />
      </MoreSub>
    </ToolbarMenu>
  );
}

/** +: everything that can be inserted, with a search above it. */
function InsertSheet({
  editor,
  showModal,
}: {
  editor: LexicalEditor;
  showModal: ShowModal;
}) {
  const [query, setQuery] = useState("");
  return (
    <ToolbarMenu label="Insert" icon={Plus}>
      <SheetSearch value={query} onChange={setQuery} label="Search blocks" />
      <InsertItems editor={editor} showModal={showModal} query={query} />
    </ToolbarMenu>
  );
}

function SheetSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}): ReactNode {
  return (
    <div className="sticky -top-1 z-10 -mx-1 -mt-1 mb-1 bg-popover p-2">
      <label className="flex h-11 items-center gap-2 rounded-md border border-input px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          aria-label={label}
          placeholder={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          // The menu would take the letters typed for its own typeahead.
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground",
          )}
        />
      </label>
    </div>
  );
}
