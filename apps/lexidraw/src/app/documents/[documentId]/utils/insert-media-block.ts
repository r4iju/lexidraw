import { $findMatchingParent } from "@lexical/utils";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRootOrShadowRoot,
  type LexicalNode,
} from "lexical";

export function $insertMediaBlock(node: LexicalNode) {
  const anchor = $getSelection()?.getNodes()[0];
  const block =
    anchor &&
    $findMatchingParent(anchor, (candidate) =>
      $isRootOrShadowRoot(candidate.getParent()),
    );
  if (block) block.insertAfter(node);
  else $getRoot().append(node);
  if (!node.getNextSibling()) node.insertAfter($createParagraphNode());
  node.selectNext();
}
