/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { SCHEMA_NODES } from "@packages/lexical-nodes";
import type { Klass, LexicalNode } from "lexical";
import { DOCUMENT_NODES } from "./document-nodes";

const registeredTypes = (nodes: Klass<LexicalNode>[]) =>
  [...createHeadlessEditor({ nodes })._nodes.keys()].sort();

test("the document editor registers every node type a stored document can hold, and no other", () => {
  expect(registeredTypes(DOCUMENT_NODES)).toEqual(
    registeredTypes(SCHEMA_NODES),
  );
});
