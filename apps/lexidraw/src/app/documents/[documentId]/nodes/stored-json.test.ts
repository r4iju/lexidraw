/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  EVERY_NODE_URL,
  STORED_BYTES_URL,
  type StoredCase,
  storedBytesMismatches,
} from "@packages/lexical-nodes/stored-fixtures";
import { DOCUMENT_NODES } from "./document-nodes";

test("the React halves read and write a stored document as the package's nodes do", async () => {
  const everyNode = await Bun.file(EVERY_NODE_URL).json();
  const editor = createHeadlessEditor({
    nodes: DOCUMENT_NODES,
    onError: (error) => {
      throw error;
    },
  });

  editor.setEditorState(editor.parseEditorState(everyNode));

  expect(JSON.parse(JSON.stringify(editor.getEditorState()))).toEqual(
    everyNode,
  );
  for (const node of editor.getEditorState()._nodeMap.values()) {
    expect(Object.getPrototypeOf(node)).toBe(
      editor._nodes.get(node.getType())?.klass.prototype,
    );
  }
});

test("the editor saves every stored node, as stored or odd, byte for byte as before", async () => {
  const cases: StoredCase[] = await Bun.file(STORED_BYTES_URL).json();

  const mismatches = storedBytesMismatches(DOCUMENT_NODES, cases);

  expect(mismatches.map(({ name }) => name)).toEqual([]);
});
