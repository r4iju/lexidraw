import { $patchStyleText } from "@lexical/selection";
import { $getSelection, type LexicalEditor } from "lexical";
import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MAX_ALLOWED_FONT_SIZE,
  MIN_ALLOWED_FONT_SIZE,
} from "../../context/toolbar-context";
import { ToolbarButton, ToolbarTooltip } from "./toolbar";
import { useToolbarUtils } from "./utils";

export default function FontSize({
  selectionFontSize,
  disabled,
  editor,
}: {
  selectionFontSize: string;
  disabled?: boolean;
  editor: LexicalEditor;
}) {
  const [inputValue, setInputValue] = useState(selectionFontSize);
  const { UpdateFontSizeType, updateFontSize } = useToolbarUtils();

  useEffect(() => {
    setInputValue(selectionFontSize);
  }, [selectionFontSize]);

  const apply = () => {
    if (inputValue === "" || inputValue === selectionFontSize) return;
    const size = Math.min(
      MAX_ALLOWED_FONT_SIZE,
      Math.max(MIN_ALLOWED_FONT_SIZE, Number(inputValue)),
    );
    setInputValue(String(size));
    editor.update(() => {
      const selection = $getSelection();
      if (selection !== null)
        $patchStyleText(selection, { "font-size": `${size}px` });
    });
  };

  const size = Number(inputValue);
  return (
    <>
      <ToolbarButton
        label="Smaller text"
        shortcut="Mod+Shift+,"
        icon={Minus}
        onClick={() =>
          updateFontSize(editor, UpdateFontSizeType.decrement, inputValue)
        }
        disabled={
          disabled || (inputValue !== "" && size <= MIN_ALLOWED_FONT_SIZE)
        }
      />
      <ToolbarTooltip label="Font size">
        <input
          type="text"
          inputMode="numeric"
          aria-label="Font size"
          value={inputValue}
          disabled={disabled}
          className="h-8 w-12 shrink-0 [appearance:textfield] rounded-md border border-input bg-transparent px-1 text-center text-label tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 pointer-coarse:h-11"
          onChange={(event) =>
            setInputValue(event.target.value.replace(/\D/g, "").slice(0, 2))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            } else if (event.key === "Escape") {
              setInputValue(selectionFontSize);
            }
          }}
          onBlur={apply}
        />
      </ToolbarTooltip>
      <ToolbarButton
        label="Larger text"
        shortcut="Mod+Shift+."
        icon={Plus}
        onClick={() =>
          updateFontSize(editor, UpdateFontSizeType.increment, inputValue)
        }
        disabled={
          disabled || (inputValue !== "" && size >= MAX_ALLOWED_FONT_SIZE)
        }
      />
    </>
  );
}
