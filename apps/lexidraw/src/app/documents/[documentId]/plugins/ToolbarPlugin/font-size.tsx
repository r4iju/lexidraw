import "./font-size.css";

import { $patchStyleText } from "@lexical/selection";
import { $getSelection, LexicalEditor } from "lexical";
import * as React from "react";
import { TooltipButton } from "../../../../../components/ui/tooltip-button";
import { Minus, Plus } from "lucide-react";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

const MIN_ALLOWED_FONT_SIZE = 8;
const MAX_ALLOWED_FONT_SIZE = 72;
const DEFAULT_FONT_SIZE = 15;

enum updateFontSizeType {
  increment = 1,
  decrement,
}

export default function FontSize({
  selectionFontSize,
  disabled,
  editor,
  className,
}: {
  selectionFontSize: string;
  disabled: boolean;
  editor: LexicalEditor;
  className?: string;
}) {
  const [inputValue, setInputValue] = React.useState<string>(selectionFontSize);
  const [inputChangeFlag, setInputChangeFlag] = React.useState<boolean>(false);

  /**
   * Calculates the new font size based on the update type.
   * @param currentFontSize - The current font size
   * @param updateType - The type of change, either increment or decrement
   * @returns the next font size
   */
  const calculateNextFontSize = (
    currentFontSize: number,
    updateType: updateFontSizeType | null,
  ) => {
    if (!updateType) {
      return currentFontSize;
    }

    let updatedFontSize: number = currentFontSize;
    switch (updateType) {
      case updateFontSizeType.decrement:
        switch (true) {
          case currentFontSize > MAX_ALLOWED_FONT_SIZE:
            updatedFontSize = MAX_ALLOWED_FONT_SIZE;
            break;
          case currentFontSize >= 48:
            updatedFontSize -= 12;
            break;
          case currentFontSize >= 24:
            updatedFontSize -= 4;
            break;
          case currentFontSize >= 14:
            updatedFontSize -= 2;
            break;
          case currentFontSize >= 9:
            updatedFontSize -= 1;
            break;
          default:
            updatedFontSize = MIN_ALLOWED_FONT_SIZE;
            break;
        }
        break;

      case updateFontSizeType.increment:
        switch (true) {
          case currentFontSize < MIN_ALLOWED_FONT_SIZE:
            updatedFontSize = MIN_ALLOWED_FONT_SIZE;
            break;
          case currentFontSize < 12:
            updatedFontSize += 1;
            break;
          case currentFontSize < 20:
            updatedFontSize += 2;
            break;
          case currentFontSize < 36:
            updatedFontSize += 4;
            break;
          case currentFontSize <= 60:
            updatedFontSize += 12;
            break;
          default:
            updatedFontSize = MAX_ALLOWED_FONT_SIZE;
            break;
        }
        break;

      default:
        break;
    }
    return updatedFontSize;
  };
  /**
   * Patches the selection with the updated font size.
   */

  const updateFontSizeInSelection = React.useCallback(
    (newFontSize: string | null, updateType: updateFontSizeType | null) => {
      const getNextFontSize = (prevFontSize: string | null): string => {
        if (!prevFontSize) {
          prevFontSize = `${DEFAULT_FONT_SIZE}px`;
        }
        prevFontSize = prevFontSize.slice(0, -2);
        const nextFontSize = calculateNextFontSize(
          Number(prevFontSize),
          updateType,
        );
        return `${nextFontSize}px`;
      };

      editor.update(() => {
        if (editor.isEditable()) {
          const selection = $getSelection();
          if (selection !== null) {
            $patchStyleText(selection, {
              "font-size": newFontSize || getNextFontSize,
            });
          }
        }
      });
    },
    [editor],
  );

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const inputValueNumber = Number(inputValue);

    if (["e", "E", "+", "-"].includes(e.key) || isNaN(inputValueNumber)) {
      e.preventDefault();
      setInputValue("");
      return;
    }
    setInputChangeFlag(true);
    if (e.key === "Enter" || e.key === "Tab" || e.key === "Escape") {
      e.preventDefault();

      updateFontSizeByInputValue(inputValueNumber);
    }
  };

  const handleInputBlur = () => {
    if (inputValue !== "" && inputChangeFlag) {
      const inputValueNumber = Number(inputValue);
      updateFontSizeByInputValue(inputValueNumber);
    }
  };

  const handleButtonClick = (updateType: updateFontSizeType) => {
    if (inputValue !== "") {
      const nextFontSize = calculateNextFontSize(
        Number(inputValue),
        updateType,
      );
      updateFontSizeInSelection(String(nextFontSize) + "px", null);
    } else {
      updateFontSizeInSelection(null, updateType);
    }
  };

  const updateFontSizeByInputValue = (inputValueNumber: number) => {
    let updatedFontSize = inputValueNumber;
    if (inputValueNumber > MAX_ALLOWED_FONT_SIZE) {
      updatedFontSize = MAX_ALLOWED_FONT_SIZE;
    } else if (inputValueNumber < MIN_ALLOWED_FONT_SIZE) {
      updatedFontSize = MIN_ALLOWED_FONT_SIZE;
    }

    setInputValue(String(updatedFontSize));
    updateFontSizeInSelection(String(updatedFontSize) + "px", null);
    setInputChangeFlag(false);
  };

  React.useEffect(() => {
    setInputValue(selectionFontSize);
  }, [selectionFontSize]);

  return (
    <>
      <TooltipButton
        onClick={() => handleButtonClick(updateFontSizeType.decrement)}
        className={cn(
          "w-12 md:w-8 h-12 md:h-10 rounded-l-md rounded-r-none border-r-0",
          className,
        )}
        disabled={
          disabled ||
          (selectionFontSize !== "" &&
            Number(inputValue) <= MIN_ALLOWED_FONT_SIZE)
        }
        title="Decrease font size"
        Icon={Minus}
        ariaLabel="Decrease font size"
      />

      <Input
        type="number"
        value={inputValue}
        disabled={disabled}
        className="max-w-fit min-w-10 h-12 md:h-10 rounded-none border-x-0"
        min={MIN_ALLOWED_FONT_SIZE}
        max={MAX_ALLOWED_FONT_SIZE}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyPress}
        onBlur={handleInputBlur}
      />

      <TooltipButton
        onClick={() => handleButtonClick(updateFontSizeType.increment)}
        className="w-12 md:w-8 h-12 md:h-10 rounded-none border-x-0"
        disabled={
          disabled ||
          (selectionFontSize !== "" &&
            Number(inputValue) >= MAX_ALLOWED_FONT_SIZE)
        }
        title="Increase font size"
        Icon={Plus}
        ariaLabel="Increase font size"
      />
    </>
  );
}
