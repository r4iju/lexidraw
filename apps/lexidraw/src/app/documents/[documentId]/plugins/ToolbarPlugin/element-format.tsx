import {
  type ElementFormatType,
  FORMAT_ELEMENT_COMMAND,
  INDENT_CONTENT_COMMAND,
  type LexicalEditor,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  IndentDecrease,
  IndentIncrease,
} from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "~/components/ui/dropdown-menu";
import { formatShortcut, ToolbarMenu } from "./toolbar";

const ALIGNMENTS = [
  {
    value: "left",
    label: "Left",
    icon: AlignLeftIcon,
    shortcut: "Mod+Shift+L",
  },
  {
    value: "center",
    label: "Center",
    icon: AlignCenterIcon,
    shortcut: "Mod+Shift+E",
  },
  {
    value: "right",
    label: "Right",
    icon: AlignRightIcon,
    shortcut: "Mod+Shift+R",
  },
  {
    value: "justify",
    label: "Justify",
    icon: AlignJustifyIcon,
    shortcut: "Mod+Shift+J",
  },
] as const;

/** Start and end read as left and right in a left-to-right document. */
function alignment(value: ElementFormatType, isRTL: boolean) {
  if (value === "start" || value === "") return isRTL ? "right" : "left";
  if (value === "end") return isRTL ? "left" : "right";
  return value;
}

export function AlignItems({
  editor,
  value,
  isRTL,
}: {
  editor: LexicalEditor;
  value: ElementFormatType;
  isRTL: boolean;
}) {
  return (
    <>
      <DropdownMenuRadioGroup value={alignment(value, isRTL)}>
        {ALIGNMENTS.map(({ value, label, icon: Icon, shortcut }) => (
          <DropdownMenuRadioItem
            key={value}
            value={value}
            className="gap-2"
            onSelect={() =>
              editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, value)
            }
          >
            <Icon className="size-4" />
            {label}
            <DropdownMenuShortcut aria-hidden="true">
              {formatShortcut(shortcut).label}
            </DropdownMenuShortcut>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2 pl-8"
        onSelect={() =>
          editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)
        }
      >
        <IndentDecrease className="size-4" />
        Outdent
        <DropdownMenuShortcut aria-hidden="true">
          {formatShortcut("Mod+[").label}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2 pl-8"
        onSelect={() =>
          editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)
        }
      >
        <IndentIncrease className="size-4" />
        Indent
        <DropdownMenuShortcut aria-hidden="true">
          {formatShortcut("Mod+]").label}
        </DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}

export function ElementFormatDropdown({
  editor,
  value,
  isRTL,
  disabled = false,
  className,
}: {
  editor: LexicalEditor;
  value: ElementFormatType;
  isRTL: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const current =
    ALIGNMENTS.find((option) => option.value === alignment(value, isRTL)) ??
    ALIGNMENTS[0];
  return (
    <ToolbarMenu
      label="Align"
      icon={current.icon}
      disabled={disabled}
      className={className}
    >
      <AlignItems editor={editor} value={value} isRTL={isRTL} />
    </ToolbarMenu>
  );
}
