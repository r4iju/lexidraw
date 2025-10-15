import {
  type ElementFormatType,
  FORMAT_ELEMENT_COMMAND,
  INDENT_CONTENT_COMMAND,
  type LexicalEditor,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  TextAlignLeftIcon,
  TextAlignCenterIcon,
  TextAlignRightIcon,
  TextAlignJustifyIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from "@radix-ui/react-icons";
import { Button } from "~/components/ui/button";

function getIconForAlignment(
  format: ElementFormatType | "",
): React.ComponentType<{ className?: string }> {
  switch (format) {
    case "left":
    case "start": // Treat start as left for icon purposes
      return TextAlignLeftIcon;
    case "center":
      return TextAlignCenterIcon;
    case "right":
    case "end": // Treat end as right for icon purposes
      return TextAlignRightIcon;
    case "justify":
      return TextAlignJustifyIcon;
    default:
      return TextAlignLeftIcon; // Default icon
  }
}

export function ElementFormatDropdown({
  editor,
  value,
  isRTL,
  disabled = false,
  className = "",
}: {
  editor: LexicalEditor;
  value: ElementFormatType;
  isRTL: boolean;
  disabled: boolean;
  className?: string;
}) {
  const SelectedIcon = getIconForAlignment(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={`flex gap-2 h-12 md:h-10 ${className}`}
          variant="outline"
          disabled={disabled}
          aria-label="Formatting options for text alignment"
        >
          <SelectedIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left");
          }}
          className="flex gap-2"
        >
          <TextAlignLeftIcon className="size-4" />
          <span className="text">Left Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center");
          }}
          className="flex gap-2"
        >
          <TextAlignCenterIcon className="size-4" />
          <span className="text">Center Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right");
          }}
          className="flex gap-2"
        >
          <TextAlignRightIcon className="size-4" />
          <span className="text">Right Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "justify");
          }}
          className="flex gap-2"
        >
          <TextAlignJustifyIcon className="size-4" />
          <span className="text">Justify Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "start");
          }}
          className="flex gap-2"
        >
          <TextAlignLeftIcon className="size-4" />
          <span className="text">Start Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "end");
          }}
          className="flex gap-2"
        >
          <TextAlignRightIcon className="size-4" />
          <span className="text">End Align</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
          }}
          className="flex gap-2"
        >
          {isRTL ? (
            <ArrowRightIcon className="size-4" />
          ) : (
            <ArrowLeftIcon className="size-4" />
          )}
          <span className="text">Outdent</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
          }}
          className="flex gap-2"
        >
          {isRTL ? (
            <ArrowLeftIcon className="size-4" />
          ) : (
            <ArrowRightIcon className="size-4" />
          )}
          <span className="text">Indent</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
