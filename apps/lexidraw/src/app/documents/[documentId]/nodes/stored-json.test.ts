/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { SCHEMA_NODES } from "@packages/lexical-nodes";
import { CommentNode } from "./CommentNode";
import { FootnoteReferenceNode } from "./FootnoteNode";
import { PageBreakNode } from "./PageBreakNode";
import { PollNode } from "./PollNode";
import { StickyNode } from "./StickyNode";
import { ThreadNode } from "./ThreadNode";

const EVERY_NODE = await Bun.file(
  new URL(
    "../../../../../../../packages/lexical-nodes/test/every-node.json",
    import.meta.url,
  ),
).json();

test("the React halves read and write a stored document as the package's nodes do", () => {
  const editor = createHeadlessEditor({
    nodes: [
      ...SCHEMA_NODES,
      CommentNode,
      ThreadNode,
      FootnoteReferenceNode,
      PageBreakNode,
      PollNode,
      StickyNode,
    ],
    onError: (error) => {
      throw error;
    },
  });

  editor.setEditorState(editor.parseEditorState(EVERY_NODE));

  expect(JSON.parse(JSON.stringify(editor.getEditorState()))).toEqual(
    EVERY_NODE,
  );
  for (const node of editor.getEditorState()._nodeMap.values()) {
    expect(Object.getPrototypeOf(node)).toBe(
      editor._nodes.get(node.getType())?.klass.prototype,
    );
  }
});
