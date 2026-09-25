import { $isTableCellNode, $isTableSelection } from "@lexical/table";
import { $findMatchingParent } from "@lexical/utils";
import { $getSelection, $isNodeSelection, $isRangeSelection } from "lexical";

/** What the phone's editing bar offers for the current selection. */
export type BarMode = "default" | "selection" | "table" | "block";

/** Null with nothing selected: the bar's own menu has taken focus. */
export function $barMode(): BarMode | null {
  const selection = $getSelection();
  if ($isNodeSelection(selection)) return "block";
  if ($isTableSelection(selection)) return "table";
  if (!$isRangeSelection(selection)) return null;
  if (!selection.isCollapsed()) return "selection";
  return $findMatchingParent(selection.anchor.getNode(), $isTableCellNode)
    ? "table"
    : "default";
}
