import {
  $exportNodeJSON,
  $getSlot,
  $getSlotNames,
  $isElementNode,
  type LexicalNode,
} from "lexical";

type ExportedNode = ReturnType<typeof $exportNodeJSON> & {
  children?: ExportedNode[];
};
/** EditorState.toJSON's recursive export for detached imported nodes. */
export function exportNode(node: LexicalNode): ExportedNode {
  const json: ExportedNode = { ...$exportNodeJSON(node) };
  if ($isElementNode(node)) json.children = node.getChildren().map(exportNode);
  const slots = $getSlotNames(node);
  if (slots.length)
    json.$slots = Object.fromEntries(
      slots.map((name) => {
        const slot = $getSlot(node, name);
        if (!slot) throw new Error(`Slot ${name} resolved to no node`);
        return [name, exportNode(slot)];
      }),
    );
  return json;
}
