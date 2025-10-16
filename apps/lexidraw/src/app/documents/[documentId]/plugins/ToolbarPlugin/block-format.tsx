import { useToolbarUtils } from "./utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import {
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  TextQuote,
  Code,
  type LucideIcon,
} from "lucide-react";
import {
  type LexicalEditor,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
} from "lexical";
import type { JSX } from "react";
import type { rootTypeToRootName } from "../../context/toolbar-context";
import { $setBlocksType } from "@lexical/selection";
import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { $createCodeNode } from "@lexical/code";

function getIconForBlockType(
  blockType:
    | "paragraph"
    | "h1"
    | "h2"
    | "h3"
    | "bullet"
    | "number"
    | "check"
    | "quote"
    | "code",
): LucideIcon {
  switch (blockType) {
    case "paragraph":
      return Pilcrow;
    case "h1":
      return Heading1;
    case "h2":
      return Heading2;
    case "h3":
      return Heading3;
    case "bullet":
      return List;
    case "number":
      return ListOrdered;
    case "check":
      return ListChecks;
    case "quote":
      return TextQuote;
    case "code":
      return Code;
    default:
      return Pilcrow; // Default to paragraph icon
  }
}

export type BlockType = Parameters<typeof getIconForBlockType>[0];

export function BlockFormatDropDown({
  editor,
  blockType,
  disabled = false,
  className = "",
}: {
  blockType: BlockType;
  rootType: keyof typeof rootTypeToRootName;
  editor: LexicalEditor;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  const formatHeading = (headingSize: HeadingTagType) => {
    if (blockType !== headingSize) {
      editor.update(() => {
        const selection = $getSelection();
        $setBlocksType(selection, () => $createHeadingNode(headingSize));
      });
    }
  };

  const formatBulletList = () => {
    if (blockType !== "bullet") {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    } else {
      formatParagraph();
    }
  };

  const formatCheckList = () => {
    if (blockType !== "check") {
      editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
    } else {
      formatParagraph();
    }
  };

  const formatNumberedList = () => {
    if (blockType !== "number") {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    } else {
      formatParagraph();
    }
  };

  const formatQuote = () => {
    if (blockType !== "quote") {
      editor.update(() => {
        const selection = $getSelection();
        $setBlocksType(selection, () => $createQuoteNode());
      });
    }
  };

  const formatCode = () => {
    if (blockType !== "code") {
      editor.update(() => {
        let selection = $getSelection();

        if (selection !== null) {
          if (selection.isCollapsed()) {
            $setBlocksType(selection, () => $createCodeNode());
          } else {
            const textContent = selection.getTextContent();
            const codeNode = $createCodeNode();
            selection.insertNodes([codeNode]);
            selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.insertRawText(textContent);
            }
          }
        }
      });
    }
  };

  const { dropDownActiveClass } = useToolbarUtils();
  const BlockIcon = getIconForBlockType(blockType);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={`flex gap-1 items-center h-12 md:h-10 ${className}`}
          aria-label="Formatting options for text style"
          disabled={disabled}
          variant="outline"
        >
          <BlockIcon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "paragraph")}`}
          onClick={formatParagraph}
        >
          <Pilcrow className="size-4" />
          <span className="text">Normal</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "h1")}`}
          onClick={() => formatHeading("h1")}
        >
          <Heading1 className="size-4" />
          <span className="text">Heading 1</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "h2")}`}
          onClick={() => formatHeading("h2")}
        >
          <Heading2 className="size-4" />
          <span className="text">Heading 2</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "h3")}`}
          onClick={() => formatHeading("h3")}
        >
          <Heading3 className="size-4" />
          <span className="text">Heading 3</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "bullet")}`}
          onClick={formatBulletList}
        >
          <List className="size-4" />
          <span className="text">Bullet List</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "number")}`}
          onClick={formatNumberedList}
        >
          <ListOrdered className="size-4" />
          <span className="text">Numbered List</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "check")}`}
          onClick={formatCheckList}
        >
          <ListChecks className="size-4" />
          <span className="text">Check List</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "quote")}`}
          onClick={formatQuote}
        >
          <TextQuote className="size-4" />
          <span className="text">Quote</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={`flex gap-2 item ${dropDownActiveClass(blockType === "code")}`}
          onClick={formatCode}
        >
          <Code className="size-4" />
          <span className="text">Code Block</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
