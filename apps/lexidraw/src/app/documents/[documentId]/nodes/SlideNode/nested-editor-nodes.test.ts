import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $getRoot } from "lexical";
import { $createMentionNode } from "@packages/lexical-nodes";
import { NESTED_EDITOR_NODES } from "./nested-editor-nodes";

test("slide text accepts the mention its mounted plugin creates", () => {
  const editor = createHeadlessEditor({ nodes: NESTED_EDITOR_NODES });
  editor.update(() => {
    $getRoot().append($createParagraphNode().append($createMentionNode("Aayla Secura")));
  }, { discrete: true });
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Aayla Secura");
});
