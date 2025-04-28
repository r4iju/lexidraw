import { useToolbarUtils } from "./utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { ChevronDownIcon } from "@radix-ui/react-icons";
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
} from "lucide-react";
import {
  LexicalEditor,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
} from "lexical";
import { JSX } from "react";
import { rootTypeToRootName } from "../../context/toolbar-context";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode, HeadingTagType } from "@lexical/rich-text";
import { INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { $createCodeNode } from "@lexical/code";

const blockTypeToBlockName = {
  bullet: "Bulleted List",
  check: "Check List",
  code: "Code Block",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  number: "Numbered List",
  paragraph: "Normal",
  quote: "Quote",
} as const;

export function BlockFormatDropDown({
  editor,
  blockType,
  disabled = false,
  className = "",
}: {
  blockType: keyof typeof blockTypeToBlockName;
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={`flex gap-1 h-12 md:h-10 ${className}`}
          aria-label="Formatting options for text style"
          disabled={disabled}
          variant="outline"
        >
          {blockTypeToBlockName[blockType]}
          <ChevronDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          className={
            "gap-2 item " + dropDownActiveClass(blockType === "paragraph")
          }
          onClick={formatParagraph}
        >
          <Pilcrow className="size-4" />
          <span className="text">Normal</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={"gap-2 item " + dropDownActiveClass(blockType === "h1")}
          onClick={() => formatHeading("h1")}
        >
          <Heading1 className="size-4" />
          <span className="text">Heading 1</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={"gap-2 item " + dropDownActiveClass(blockType === "h2")}
          onClick={() => formatHeading("h2")}
        >
          <Heading2 className="size-4" />
          <span className="text">Heading 2</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={"gap-2 item " + dropDownActiveClass(blockType === "h3")}
          onClick={() => formatHeading("h3")}
        >
          <Heading3 className="size-4" />
          <span className="text">Heading 3</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={
            "gap-2 item " + dropDownActiveClass(blockType === "bullet")
          }
          onClick={formatBulletList}
        >
          <List className="size-4" />
          <span className="text">Bullet List</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={
            "gap-2 item " + dropDownActiveClass(blockType === "number")
          }
          onClick={formatNumberedList}
        >
          <ListOrdered className="size-4" />
          <span className="text">Numbered List</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={"gap-2 item " + dropDownActiveClass(blockType === "check")}
          onClick={formatCheckList}
        >
          <ListChecks className="size-4" />
          <span className="text">Check List</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={"gap-2 item " + dropDownActiveClass(blockType === "quote")}
          onClick={formatQuote}
        >
          <TextQuote className="size-4" />
          <span className="text">Quote</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={"gap-2 item " + dropDownActiveClass(blockType === "code")}
          onClick={formatCode}
        >
          <Code className="size-4" />
          <span className="text">Code Block</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
