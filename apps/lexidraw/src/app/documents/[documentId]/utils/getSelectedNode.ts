import { $isAtNodeEnd } from "@lexical/selection";
import { ElementNode, RangeSelection, TextNode } from "lexical";
import { useCallback } from "react";

export function useGetSelectedNode(): (
  selection: RangeSelection,
) => TextNode | ElementNode {
  function getSelectedNode(selection: RangeSelection): TextNode | ElementNode {
    const anchor = selection.anchor;
    const focus = selection.focus;
    const anchorNode = selection.anchor.getNode();
    const focusNode = selection.focus.getNode();
    if (anchorNode === focusNode) {
      return anchorNode;
    }
    const isBackward = selection.isBackward();
    if (isBackward) {
      return $isAtNodeEnd(focus) ? anchorNode : focusNode;
    } else {
      return $isAtNodeEnd(anchor) ? anchorNode : focusNode;
    }
  }

  return useCallback(
    (selection: RangeSelection) => getSelectedNode(selection),
    [],
  );
}
