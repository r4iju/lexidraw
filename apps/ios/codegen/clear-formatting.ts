import { readFileSync } from "node:fs";

export function referenceClearFormatting(): string {
  const source = readFileSync(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/plugins/ToolbarPlugin/utils.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const body = source.match(
    / {2}const clearFormatting = \(editor: LexicalEditor\) => \{[\s\S]*?\n {2}\};/,
  )?.[0];
  if (!body) throw new Error("Unknown web clear-formatting shape");
  return `// Generated original web toolbar operation for the reference oracle.\nimport { $createParagraphNode, $getSelection, $isRangeSelection, $isTextNode, type LexicalEditor } from "lexical";\nimport { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";\nimport { $isTableSelection } from "@lexical/table";\nimport { $getNearestBlockElementAncestorOrThrow } from "@lexical/utils";\nimport { $isDecoratorBlockNode } from "@lexical/react/LexicalDecoratorBlockNode";\nexport ${body.trim()}\n`;
}
