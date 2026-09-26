import { createHeadlessEditor } from "@lexical/headless";
import type { Klass, LexicalNode, SerializedLexicalNode } from "lexical";

/** A stored document that holds every node a document can. */
export const EVERY_NODE_URL = new URL(
  "../test/every-node.json",
  import.meta.url,
);

/**
 * Stored nodes, as stored and odd, each with what the nodes wrote for it
 * before they declared their schemas (`emanuel/110-node-schemas`), recorded by
 * running those nodes headless.
 */
export const STORED_BYTES_URL = new URL(
  "../test/stored-bytes.json",
  import.meta.url,
);

/**
 * One recorded save. The document is a root holding `node`; the save is that
 * root holding `output`, or `node` where it's left out. `threw` marks a node
 * the old nodes couldn't read at all.
 */
export type StoredCase = {
  name: string;
  node: SerializedLexicalNode;
  output?: SerializedLexicalNode[];
  threw?: true;
};

export type StoredMismatch = {
  name: string;
  expected: string;
  written: string;
};

const ROOT = {
  direction: null,
  format: "",
  indent: 0,
  type: "root",
  version: 1,
};

function document(children: SerializedLexicalNode[]) {
  return { root: { children, ...ROOT } };
}

/**
 * Loads and saves each case's document with `nodes`, as the web editor saves
 * one, and lists those whose save isn't the recorded string.
 */
export function storedBytesMismatches(
  nodes: Klass<LexicalNode>[],
  cases: StoredCase[],
): StoredMismatch[] {
  const mismatches: StoredMismatch[] = [];
  for (const { name, node, output, threw } of cases) {
    const editor = createHeadlessEditor({
      nodes,
      onError: (error) => {
        throw error;
      },
    });
    let written: string;
    try {
      editor.setEditorState(editor.parseEditorState(document([node])));
      written = JSON.stringify(editor.getEditorState());
    } catch (error) {
      written = `throws ${String(error)}`;
    }
    const expected = threw
      ? written
      : JSON.stringify(document(output ?? [node]));
    if (written !== expected || written.startsWith("throws ")) {
      mismatches.push({ name, expected, written });
    }
  }
  return mismatches;
}
