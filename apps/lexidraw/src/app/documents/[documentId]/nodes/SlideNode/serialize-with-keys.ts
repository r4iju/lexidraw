import { EditorState, LexicalNode, $getRoot, $isElementNode } from "lexical";

function serialize(node: LexicalNode): SerializedNodeWithKey {
  const base = node.exportJSON() as SerializedNodeWithKey;
  base.key = node.getKey();
  if ($isElementNode(node)) {
    base.children = node.getChildren().map(serialize);
  }
  return base;
}

type SerializedNodeWithKey = ReturnType<LexicalNode["exportJSON"]> & {
  key: string;
  children?: SerializedNodeWithKey[];
};

export function exportWithKeys(state: EditorState): SerializedNodeWithKey {
  return state.read(() => serialize($getRoot()));
}
