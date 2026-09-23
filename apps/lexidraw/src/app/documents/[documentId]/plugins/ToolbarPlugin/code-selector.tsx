import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  CODE_LANGUAGE_OPTIONS,
  getCodeLanguageFriendlyName,
} from "../code-language";
import { useCallback } from "react";
import { useToolbarUtils } from "./utils";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";
import { $isCodeNode } from "@lexical/code";

type CodeSelectorProps = {
  activeEditor: LexicalEditor;
  selectedElementKey: NodeKey | null;
  isEditable: boolean;
  codeLanguage: string;
};

export function CodeSelector({
  activeEditor,
  selectedElementKey,
  isEditable,
  codeLanguage,
}: CodeSelectorProps) {
  const { dropDownActiveClass } = useToolbarUtils();

  const onCodeLanguageSelect = useCallback(
    (value: string) => {
      activeEditor.update(() => {
        if (selectedElementKey !== null) {
          const node = $getNodeByKey(selectedElementKey);
          if ($isCodeNode(node)) {
            node.setLanguage(value);
          }
        }
      });
    },
    [activeEditor, selectedElementKey],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={!isEditable}
          className="flex gap-1 h-12 md:h-10"
          aria-label="Select language"
        >
          {getCodeLanguageFriendlyName(codeLanguage)}
          <ChevronDownIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {CODE_LANGUAGE_OPTIONS.map(([value, name]) => {
          return (
            <DropdownMenuItem
              className={`item ${dropDownActiveClass(value === codeLanguage)}`}
              onClick={() => onCodeLanguageSelect(value)}
              key={value}
            >
              <span className="text">{name}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
