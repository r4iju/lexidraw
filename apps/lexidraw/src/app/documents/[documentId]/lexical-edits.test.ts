/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $dfs } from "@lexical/utils";
import { StickyNode } from "@packages/lexical-nodes";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
} from "lexical";
import { trackLexicalEdits } from "./lexical-edits";

/** The last sticky note in a document: an inline node, so inside a paragraph. */
function lastSticky(root: LexicalEditor): LexicalEditor {
  const found = root
    .getEditorState()
    .read(() => $dfs().filter(({ node }) => node instanceof StickyNode));
  const last = found.at(-1)?.node;
  if (!(last instanceof StickyNode)) throw new Error("no sticky");
  return last.__caption;
}

/** A document holding one sticky note, whose text lives in its own editor. */
function documentWithSticky() {
  const root = createHeadlessEditor({
    nodes: [StickyNode],
    onError: (e) => {
      throw e;
    },
  });
  root.update(
    () => {
      $getRoot().append($createParagraphNode(), new StickyNode());
    },
    { discrete: true, tag: HISTORY_MERGE_TAG },
  );
  return { root, sticky: lastSticky(root) };
}

function type(editor: LexicalEditor, text: string, tag?: string) {
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true, tag },
  );
}

describe("which updates to an open document are the user's", () => {
  test("typing in a nested editor, like a sticky note or a caption, is an edit", () => {
    const { root, sticky } = documentWithSticky();
    const edits = trackLexicalEdits(root);
    expect(edits.hasLocalEdits()).toBe(false);

    type(sticky, "a note");
    expect(edits.hasLocalEdits()).toBe(true);

    // The save sends the whole document, the note included.
    edits.saved(JSON.stringify(root.getEditorState()));
    expect(edits.hasLocalEdits()).toBe(false);
    edits.dispose();
  });

  test("a nested editor's own passes, like highlighting, are not edits", () => {
    const { root, sticky } = documentWithSticky();
    const edits = trackLexicalEdits(root);

    type(sticky, "highlighted", HISTORY_MERGE_TAG);
    expect(edits.hasLocalEdits()).toBe(false);
    edits.dispose();
  });

  test("a sticky note added after the document opened is watched too", () => {
    const { root } = documentWithSticky();
    const edits = trackLexicalEdits(root);
    root.update(
      () => {
        $getRoot().append(new StickyNode());
      },
      { discrete: true },
    );
    edits.saved(JSON.stringify(root.getEditorState()));

    type(lastSticky(root), "later");
    expect(edits.hasLocalEdits()).toBe(true);
    edits.dispose();
  });
});
