/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { SCHEMA_NODES } from "@packages/lexical-nodes";
import {
  EVERY_NODE_URL,
  STORED_BYTES_URL,
  type StoredCase,
  storedBytesMismatches,
} from "@packages/lexical-nodes/stored-fixtures";
import { DOCUMENT_NODES } from "./document-nodes";

/**
 * The document editor's nodes, after the package's: a stored document can
 * hold nodes the editor doesn't register, such as an emoji.
 */
const NODES = [...SCHEMA_NODES, ...DOCUMENT_NODES];

test("the React halves read and write a stored document as the package's nodes do", async () => {
  const everyNode = await Bun.file(EVERY_NODE_URL).json();
  const editor = createHeadlessEditor({
    nodes: NODES,
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

  const mismatches = storedBytesMismatches(NODES, cases);

  expect(mismatches.map(({ name }) => name)).toEqual([]);
});
