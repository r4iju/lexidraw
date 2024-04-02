import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  ElementFormatType,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  LexicalCommand,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  CodeIcon,
  CrossIcon,
  ItalicIcon,
  RedoIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UndoIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ElementType } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";

const LowPriority = 1;

type ActionOption = "redo" | "undo";
const actionOptions: readonly {
  action: ActionOption;
  command: LexicalCommand<void>;
}[] = [
  { action: "undo", command: UNDO_COMMAND },
  { action: "redo", command: REDO_COMMAND },
] as const;

type ElementOption = Extract<
  ElementFormatType,
  "left" | "center" | "right" | "justify"
>;
const elementFormats: readonly {
  action: ElementOption;
  command: LexicalCommand<string>;
}[] = [
  {
    action: "left",
    command: FORMAT_ELEMENT_COMMAND,
  },
  {
    action: "center",
    command: FORMAT_ELEMENT_COMMAND,
  },
  {
    action: "right",
    command: FORMAT_ELEMENT_COMMAND,
  },
  {
    action: "justify",
    command: FORMAT_ELEMENT_COMMAND,
  },
] as const;

type TextOption = Extract<
  TextFormatType,
  "bold" | "underline" | "strikethrough" | "italic" | "code"
>;
const textFormats: readonly {
  action: TextOption;
  command: LexicalCommand<string>;
}[] = [
  {
    action: "bold",
    command: FORMAT_TEXT_COMMAND,
  },
  {
    action: "underline",
    command: FORMAT_TEXT_COMMAND,
  },
  {
    action: "strikethrough",
    command: FORMAT_TEXT_COMMAND,
  },
  {
    action: "italic",
    command: FORMAT_TEXT_COMMAND,
  },
  {
    action: "code",
    command: FORMAT_TEXT_COMMAND,
  },
] as const;

type Option = ElementOption | ActionOption | TextOption;

const getIconComponent = (option: Option) => {
  switch (option) {
    case "undo":
      return UndoIcon;
    case "redo":
      return RedoIcon;
    case "bold":
      return BoldIcon;
    case "italic":
      return ItalicIcon;
    case "underline":
      return UnderlineIcon;
    case "strikethrough":
      return StrikethroughIcon;
    case "code":
      return CodeIcon;
    case "left":
      return AlignLeftIcon;
    case "center":
      return AlignCenterIcon;
    case "right":
      return AlignRightIcon;
    case "justify":
      return AlignJustifyIcon;
    default:
      console.error(`Invalid option: ${option satisfies never}`);
      return CrossIcon;
  }
};

function Divider() {
  return <div className="w-[1px] bg-gray-200 my-0 mx-1" />;
}

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const isDarkTheme = useIsDarkTheme();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [toggledValues, setToggledValues] = useState<TextOption[]>([]);
  const [toggledStyle, setToggledStyle] = useState<ElementOption>("left");

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // should update toggledValues
      for (const text of textFormats) {
        if (selection.hasFormat(text.action)) {
          setToggledValues((prev) => [...prev, text.action]);
        } else {
          setToggledValues((prev) =>
            prev.filter((value) => value !== text.action),
          );
        }
      }
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

  const onValueChange = useCallback(
    (newValues: TextOption[]) => {
      // diff
      const newlyToggled = newValues.filter(
        (value) => !toggledValues.includes(value),
      );
      const untoggled = toggledValues.filter(
        (value) => !newValues.includes(value),
      );
      for (const value of [...newlyToggled, ...untoggled]) {
        const text = textFormats.find((option) => option.action === value);
        if (text) {
          editor.dispatchCommand(text.command, value);
        }
      }
      setToggledValues(newValues);
    },
    [editor, toggledValues],
  );

  const onActionChange = useCallback(
    (value: ActionOption) => {
      const action = actionOptions.find((option) => option.action === value);
      if (action) {
        editor.dispatchCommand(action.command, undefined);
      }
    },
    [editor, toggledValues],
  );

  const onStyleChange = useCallback(
    (newStyle: ElementOption) => {
      const elementStyle = elementFormats.find(
        (option) => option.action === newStyle,
      );
      if (elementStyle) {
        editor.dispatchCommand(elementStyle.command, elementStyle.action);
      }
      setToggledStyle(newStyle);
    },
    [editor, toggledValues],
  );

  const renderToggleButton = <T extends Option>(
    value: T,
    IconComponent: ElementType,
    ariaLabel: string,
  ) => (
    <ToggleGroupItem
      key={value}
      className="px-1 py-0.5"
      disabled={
        (value === "undo" && !canUndo) || (value === "redo" && !canRedo)
      }
      value={value}
      aria-label={ariaLabel}
    >
      <IconComponent
        className="w-4 h-4"
        color={isDarkTheme ? "white" : "black"}
      />
    </ToggleGroupItem>
  );

  return (
    <div className="flex flex-row px-4 py-2 gap-2 bg-white backdrop-blur-lg shadow-lg dark:border-slate-300 dark:bg-black rounded-lg">
      <ToggleGroup
        type="single"
        variant="outline"
        value=""
        onValueChange={onActionChange}
      >
        {actionOptions.map((action) => {
          const IconComponent = getIconComponent(action.action);
          return renderToggleButton<ActionOption>(
            action.action,
            IconComponent,
            action.action,
          );
        })}
      </ToggleGroup>
      <Divider />
      <ToggleGroup
        type="multiple"
        variant="outline"
        value={toggledValues}
        onValueChange={onValueChange}
      >
        {textFormats.map((text) => {
          const IconComponent = getIconComponent(text.action);
          return renderToggleButton<TextOption>(
            text.action,
            IconComponent,
            text.action,
          );
        })}
      </ToggleGroup>
      <Divider />
      <ToggleGroup
        type="single"
        variant="outline"
        value={toggledStyle}
        onValueChange={onStyleChange}
      >
        {elementFormats.map((element) => {
          const IconComponent = getIconComponent(element.action);
          return renderToggleButton<ElementOption>(
            element.action,
            IconComponent,
            element.action,
          );
        })}
      </ToggleGroup>
    </div>
  );
}
