import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CodeIcon,
  ItalicIcon,
  RedoIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UndoIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as React from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Button } from "~/components/ui/button";

const LowPriority = 1;

function Divider() {
  return <div className="w-[1px] bg-gray-200 my-0 mx-1" />;
}

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = useRef(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isLeft, setIsLeft] = useState(false);
  const isDarkTheme = useIsDarkTheme();

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // Update text format
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));
      setIsCode(selection.hasFormat("code"));
    }
  }, []);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_payload, newEditor) => {
          updateToolbar();
          return false;
        },
        LowPriority,
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        LowPriority,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        LowPriority,
      ),
    );
  }, [editor, updateToolbar]);
  return (
    <div
      className="flex gap-3 px-4 py-2 bg-white backdrop-blur-lg shadow-lg dark:border-slate-600 dark:bg-zinc-800 rounded-lg"
      ref={toolbarRef}
    >
      <Button
        disabled={!canUndo}
        variant={"outline"}
        size="sm"
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        className="disabled:opacity-50 p-2 rounded-lg cursor-pointer"
      >
        <UndoIcon className="w-4 h-4" color={isDarkTheme ? "white" : "black"} />
      </Button>
      <Button
        disabled={!canRedo}
        variant={"outline"}
        size="sm"
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        className="disabled:opacity-50 p-2 rounded-lg cursor-pointer"
      >
        <RedoIcon className="w-4 h-4" color={isDarkTheme ? "white" : "black"} />
      </Button>
      <Divider />
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
        }}
        variant={"outline"}
        size="sm"
        className={`p-2 rounded-lg cursor-pointer ${isBold ? "" : "opacity-50"}`}
        aria-label="Format Bold"
      >
        <BoldIcon className="w-4 h-4" color={isDarkTheme ? "white" : "black"} />
      </Button>
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
        }}
        variant={"outline"}
        size="sm"
        className={`p-2 rounded-lg cursor-pointer ${isItalic ? "" : "opacity-50"}`}
        aria-label="Format Italics"
      >
        <ItalicIcon
          className="w-4 h-4"
          color={isDarkTheme ? "white" : "black"}
        />
      </Button>
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
        }}
        variant={"outline"}
        size="sm"
        className={`p-2 rounded-lg cursor-pointer ${isUnderline ? "" : "opacity-50"}`}
      >
        <UnderlineIcon
          className="w-4 h-4"
          color={isDarkTheme ? "white" : "black"}
        />
      </Button>
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
        }}
        variant={"outline"}
        size="sm"
        className={`p-2 rounded-lg cursor-pointer ${isStrikethrough ? "" : "opacity-50"}`}
        aria-label="Format Strikethrough"
      >
        <StrikethroughIcon
          className="w-4 h-4"
          color={isDarkTheme ? "white" : "black"}
        />
      </Button>
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
        }}
        variant={"outline"}
        size="sm"
        className={`p-2 rounded-lg cursor-pointer ${isCode ? "" : "opacity-50"}`}
        aria-label="Format code"
      >
        <CodeIcon className="w-4 h-4" color={isDarkTheme ? "white" : "black"} />
      </Button>
      <Divider />
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left");
        }}
        variant={"outline"}
        size="sm"
        className="p-2 rounded-lg cursor-pointer"
        aria-label="Left Align"
      >
        <AlignLeftIcon
          className="w-4 h-4"
          color={isDarkTheme ? "white" : "black"}
        />
      </Button>
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center");
        }}
        variant={"outline"}
        size="sm"
        className="p-2 rounded-lg cursor-pointer"
        aria-label="Center Align"
      >
        <AlignCenterIcon
          className="w-4 h-4"
          color={isDarkTheme ? "white" : "black"}
        />
      </Button>
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right");
        }}
        variant={"outline"}
        size="sm"
        className="p-2 rounded-lg cursor-pointer"
        aria-label="Right Align"
      >
        <AlignRightIcon
          className="w-4 h-4"
          color={isDarkTheme ? "white" : "black"}
        />
      </Button>
      <Button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "justify");
        }}
        variant={"outline"}
        size="sm"
        className="p-2 rounded-lg cursor-pointer"
        aria-label="Justify Align"
      >
        <AlignJustifyIcon
          className="w-4 h-4"
          color={isDarkTheme ? "white" : "black"}
        />
      </Button>
      {""}
    </div>
  );
}
