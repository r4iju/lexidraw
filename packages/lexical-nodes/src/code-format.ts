import { $createCodeNode } from "@lexical/code";
import { $setBlocksType } from "@lexical/selection";
import { $getSelection, $isRangeSelection, type BaseSelection } from "lexical";

/** The toolbar's code-block conversion, shared by the native command oracle. */
export function $formatCode(selection: BaseSelection | null): void {
  if (!selection) return;
  if (selection.isCollapsed()) {
    $setBlocksType(selection, () => $createCodeNode());
  } else {
    const text = selection.getTextContent();
    selection.insertNodes([$createCodeNode()]);
    const next = $getSelection();
    if ($isRangeSelection(next)) next.insertRawText(text);
  }
}
