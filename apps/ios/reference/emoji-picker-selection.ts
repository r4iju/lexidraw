import { createHeadlessEditor } from "@lexical/headless";
import {
  $createParagraphNode,
  $getNodeByKey,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import { $selectEmoji } from "../../lexidraw/src/app/documents/[documentId]/plugins/EmojiPickerPlugin/options.js";
const editor = createHeadlessEditor({
  onError(error) {
    throw error;
  },
});
let result: unknown;
let queryKey = "";
editor.update(
  () => {
    const paragraph = $createParagraphNode();
    $getRoot().append(paragraph);
    paragraph.select();
    const typing = $getSelection();
    if (!$isRangeSelection(typing)) throw new Error("No typing range");
    typing.format = 1;
    typing.style = "color: red;";
    typing.insertText(":smile");
    queryKey = typing.anchor.getNode().getKey();
  },
  { discrete: true },
);
editor.update(
  () => {
    const query = $getNodeByKey(queryKey);
    if (!query || query.getType() !== "text") throw new Error("Missing query");
    const before = $getSelection();
    if (!$isRangeSelection(before)) throw new Error("No range");
    const prior = { format: before.format, style: before.style };
    if (!$selectEmoji("😀", query as ReturnType<typeof $createTextNode>))
      throw new Error("Callback refused");
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error("No range after emoji");
    result = {
      prior,
      after: { format: selection.format, style: selection.style },
      inserted: $getRoot()
        .getAllTextNodes()
        .map((node) => node.exportJSON()),
    };
    selection.insertText("!");
  },
  { discrete: true },
);
console.log(
  JSON.stringify(
    { selection: result, state: editor.getEditorState().toJSON() },
    null,
    2,
  ),
);
