import { createHeadlessEditor } from "@lexical/headless";
import type { Klass, LexicalNode, SerializedLexicalNode } from "lexical";
import { EMPTY_ROOT } from "./schema-values.js";

/** A stored document that holds every node a document can. */
export const EVERY_NODE_URL = new URL(
  "../test/every-node.json",
  import.meta.url,
);

/**
 * Stored nodes, as stored and odd, each with what it saved as before the
 * nodes declared their schemas: "Stored bytes" in `docs/lexical-upgrade.md`.
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

/** A stored document whose root holds `children`. */
export function storedDocument(children: SerializedLexicalNode[]) {
  return { root: { ...EMPTY_ROOT, children } };
}

/**
 * The document `node` is in, loaded and saved with `nodes` as the web editor
 * saves one.
 */
function savedWith(nodes: Klass<LexicalNode>[], node: SerializedLexicalNode) {
  const editor = createHeadlessEditor({
    nodes,
    onError: (error) => {
      throw error;
    },
  });
  editor.setEditorState(editor.parseEditorState(storedDocument([node])));
  return JSON.stringify(editor.getEditorState());
}

/**
 * Loads and saves each case's document with `nodes`, and lists those whose
 * save isn't the recorded string.
 */
export function storedBytesMismatches(
  nodes: Klass<LexicalNode>[],
  cases: StoredCase[],
): StoredMismatch[] {
  const mismatches: StoredMismatch[] = [];
  for (const { name, node, output, threw } of cases) {
    let written: string;
    try {
      written = savedWith(nodes, node);
    } catch (error) {
      written = `throws ${String(error)}`;
    }
    const expected = threw
      ? written
      : JSON.stringify(storedDocument(output ?? [node]));
    if (written !== expected || written.startsWith("throws ")) {
      mismatches.push({ name, expected, written });
    }
  }
  return mismatches;
}

/**
 * `cases` with those `named` recorded again: what `nodes` save for each now,
 * left out where that is the node as stored.
 */
export function rerecorded(
  nodes: Klass<LexicalNode>[],
  cases: StoredCase[],
  named: string[],
): StoredCase[] {
  return cases.map((stored) => {
    if (!named.includes(stored.name)) return stored;
    const { name, node } = stored;
    const output: SerializedLexicalNode[] = JSON.parse(savedWith(nodes, node))
      .root.children;
    return JSON.stringify(output) === JSON.stringify([node])
      ? { name, node }
      : { name, node, output };
  });
}

/** The committed file's exact text for `cases`, a case a line. */
export function storedBytesFile(cases: StoredCase[]): string {
  return `[\n${cases.map((stored) => JSON.stringify(stored)).join(",\n")}\n]\n`;
}
