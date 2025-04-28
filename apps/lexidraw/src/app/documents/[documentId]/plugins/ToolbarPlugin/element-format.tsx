import { ElementFormatType, FORMAT_ELEMENT_COMMAND, INDENT_CONTENT_COMMAND, LexicalEditor, OUTDENT_CONTENT_COMMAND } from "lexical";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { Button } from "~/components/ui/button";

const ELEMENT_FORMAT_OPTIONS: Record<
  Exclude<ElementFormatType, "">,
  { icon: string; iconRTL: string; name: string }
> = {
  center: {
    icon: "center-align",
    iconRTL: "center-align",
    name: "Center Align",
  },
  end: { icon: "right-align", iconRTL: "left-align", name: "End Align" },
  justify: {
    icon: "justify-align",
    iconRTL: "justify-align",
    name: "Justify Align",
  },
  left: { icon: "left-align", iconRTL: "left-align", name: "Left Align" },
  right: { icon: "right-align", iconRTL: "right-align", name: "Right Align" },
  start: { icon: "left-align", iconRTL: "right-align", name: "Start Align" },
};

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
  const formatOption = ELEMENT_FORMAT_OPTIONS[value || "left"];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={`flex gap-1 h-12 md:h-10 ${className}`}
          variant="outline"
          disabled={disabled}
          aria-label="Formatting options for text alignment"
        >
          {formatOption.name}
          <ChevronDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left");
          }}
          className="item"
        >
          <i className="icon left-align" />
          <span className="text">Left Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center");
          }}
          className="item"
        >
          <i className="icon center-align" />
          <span className="text">Center Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right");
          }}
          className="item"
        >
          <i className="icon right-align" />
          <span className="text">Right Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "justify");
          }}
          className="item"
        >
          <i className="icon justify-align" />
          <span className="text">Justify Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "start");
          }}
          className="item"
        >
          <i
            className={`icon ${
              isRTL
                ? ELEMENT_FORMAT_OPTIONS.start.iconRTL
                : ELEMENT_FORMAT_OPTIONS.start.icon
            }`}
          />
          <span className="text">Start Align</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "end");
          }}
          className="item"
        >
          <i
            className={`icon ${
              isRTL
                ? ELEMENT_FORMAT_OPTIONS.end.iconRTL
                : ELEMENT_FORMAT_OPTIONS.end.icon
            }`}
          />
          <span className="text">End Align</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
          }}
          className="item"
        >
          <i className={"icon " + (isRTL ? "indent" : "outdent")} />
          <span className="text">Outdent</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
          }}
          className="item"
        >
          <i className={"icon " + (isRTL ? "outdent" : "indent")} />
          <span className="text">Indent</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
