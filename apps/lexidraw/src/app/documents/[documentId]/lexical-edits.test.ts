/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { $dfs } from "@lexical/utils";
import { StickyNode } from "@packages/lexical-nodes";
import { JSDOM } from "jsdom";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
} from "lexical";
import { trackLexicalEdits } from "./lexical-edits";

// Lexical reports mutations while it reconciles the DOM, so the document
// needs a root element to render into, as it has in the browser.
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
const BROWSER = [
  "window",
  "document",
  "MutationObserver",
  "Node",
  "Element",
  "HTMLElement",
] as const;
const before = new Map(BROWSER.map((name) => [name, globals[name]]));
beforeAll(() => {
  const window = dom.window as unknown as Record<string, unknown>;
  for (const name of BROWSER) globals[name] = window[name];
  globals.window = dom.window;
});
afterAll(() => {
  for (const [name, value] of before) {
    if (value === undefined) delete globals[name];
    else globals[name] = value;
  }
});

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
  const root = createEditor({
    nodes: [StickyNode],
    onError: (e) => {
      throw e;
    },
  });
  root.setRootElement(dom.window.document.createElement("div"));
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

  test("a nested editor whose node was removed is let go", () => {
    const { root, sticky } = documentWithSticky();
    const edits = trackLexicalEdits(root);
    const listening = () => sticky._listeners.update.size;
    expect(listening()).toBeGreaterThan(0);

    root.update(
      () => {
        for (const { node } of $dfs()) {
          if (node instanceof StickyNode) node.remove();
        }
      },
      { discrete: true },
    );

    expect(listening()).toBe(0);
    edits.dispose();
  });

  test("letting go of the document lets go of every nested editor", () => {
    const { root, sticky } = documentWithSticky();
    trackLexicalEdits(root).dispose();
    expect(root._listeners.update.size).toBe(0);
    expect(sticky._listeners.update.size).toBe(0);
  });
});
