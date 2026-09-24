import { $isCodeNode } from "@lexical/code";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "~/components/ui/dropdown-menu";
import {
  CODE_LANGUAGE_OPTIONS,
  getCodeLanguageFriendlyName,
} from "../code-language";
import { ToolbarMenu } from "./toolbar";

type CodeLanguageProps = {
  editor: LexicalEditor;
  selectedElementKey: NodeKey | null;
  codeLanguage: string;
};

export function CodeLanguageItems({
  editor,
  selectedElementKey,
  codeLanguage,
}: CodeLanguageProps) {
  return (
    <DropdownMenuRadioGroup
      value={codeLanguage}
      onValueChange={(language) =>
        editor.update(() => {
          const node =
            selectedElementKey === null
              ? null
              : $getNodeByKey(selectedElementKey);
          if ($isCodeNode(node)) node.setLanguage(language);
        })
      }
    >
      {CODE_LANGUAGE_OPTIONS.map(([value, name]) => (
        <DropdownMenuRadioItem key={value} value={value}>
          {name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** Takes the font's place in code, at the font's width. */
export function CodeSelector(
  props: CodeLanguageProps & { disabled?: boolean },
) {
  return (
    <ToolbarMenu
      label="Code language"
      disabled={props.disabled}
      trigger={
        <span className="w-24 truncate text-left">
          {getCodeLanguageFriendlyName(props.codeLanguage)}
        </span>
      }
    >
      <CodeLanguageItems {...props} />
    </ToolbarMenu>
  );
}
