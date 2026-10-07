/// <reference types="bun" />
import { installDom, render } from "~/test/dom";
installDom();
import { afterEach, expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { act } from "react";
import {
  $createNodeSelection,
  $getRoot,
  $setSelection,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { DOCUMENT_NODES } from "../document-nodes";

function textBox(id: string, ...paragraphs: string[]) {
  return {
    kind: "box",
    id,
    x: 50,
    y: 40,
    width: 300,
    height: "inherit",
    zIndex: 0,
    editorStateJSON: {
      root: {
        key: "root",
        type: "root",
        version: 1,
        children: paragraphs.map((text, index) => ({
          key: `${id}-p${index}`,
          type: "paragraph",
          version: 1,
          children: [
            {
              key: `${id}-t${index}`,
              type: "text",
              version: 1,
              text,
              format: 0,
              style: "",
              mode: "normal",
              detail: 0,
            },
          ],
        })),
      },
    },
  };
}

/** A deck as the slide editor saved one, with a chart it can no longer draw. */
const DECK = {
  type: "slide-deck",
  version: 1,
  data: {
    currentSlideId: "s1",
    slides: [
      {
        id: "s1",
        backgroundColor: "#111827",
        elements: [
          textBox("b1", "Quarterly results", "Revenue grew 12%"),
          {
            kind: "chart",
            id: "c1",
            x: 0,
            y: 0,
            width: 200,
            height: 200,
            zIndex: 1,
            chartType: "pie",
            chartData: "[]",
            chartConfig: "{}",
          },
        ],
      },
      { id: "s2", elements: [textBox("b2", "Next steps")] },
    ],
  },
};

const STORED = {
  root: {
    type: "root",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: [DECK],
  },
};

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function open(): Promise<LexicalEditor> {
  let editor: LexicalEditor | undefined;
  ({ unmount } = await render(
    <LexicalComposer
      initialConfig={{
        namespace: "legacy-slide-deck",
        nodes: DOCUMENT_NODES,
        editorState: JSON.stringify(STORED),
        onError(error) {
          throw error;
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <EditorRef onEditor={(value) => (editor = value)} />
    </LexicalComposer>,
  ));
  if (!editor) throw new Error("no editor");
  return editor;
}

function EditorRef({
  onEditor,
}: {
  onEditor: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  onEditor(editor);
  return null;
}

test("a stored slide deck loads as a placeholder that shows its text", async () => {
  await open();

  const block = document.querySelector('[data-node-type="slide-deck"]');
  expect(block?.textContent).toContain("Slide deck (no longer supported)");
  expect(
    [...(block?.querySelectorAll("li") ?? [])].map((item) => item.textContent),
  ).toEqual(["Quarterly results", "Revenue grew 12%", "Next steps"]);
});

test("a stored slide deck saves back exactly as it was stored", async () => {
  const editor = await open();

  expect(
    JSON.parse(JSON.stringify(editor.getEditorState())).root.children,
  ).toEqual([DECK]);
});

test("the placeholder is deleted like any block", async () => {
  const editor = await open();

  await act(async () => {
    editor.update(
      () => {
        const selection = $createNodeSelection();
        selection.add($getRoot().getFirstChildOrThrow().getKey());
        $setSelection(selection);
      },
      { discrete: true },
    );
  });
  await act(async () => {
    editor.dispatchCommand(
      KEY_BACKSPACE_COMMAND,
      new window.KeyboardEvent("keydown", { key: "Backspace" }),
    );
  });

  const types = editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getType()),
  );
  expect(types).not.toContain("slide-deck");
});
