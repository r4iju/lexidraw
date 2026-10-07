/// <reference types="bun" />
import { installDom, render } from "~/test/dom";

installDom("https://app.test/documents/1");

import { expect, mock, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ExcalidrawNode as HeadlessExcalidrawNode } from "@packages/lexical-nodes";
import {
  $getRoot,
  $getSelection,
  $isNodeSelection,
  type LexicalEditor,
} from "lexical";
import { act } from "react";

// Drawing the picture and editing it are Excalidraw's; here the editor only
// has to open.
mock.module("@excalidraw/excalidraw", () => ({
  exportToSvg: async () =>
    document.createElementNS("http://www.w3.org/2000/svg", "svg"),
}));
mock.module("./ExcalidrawModal", () => ({
  default: () => <div role="dialog" aria-label="Drawing editor" />,
}));

const { ExcalidrawNode } = await import("./index");

/** A saved document holding one drawing of `elements`. */
function saved(elements: unknown[]) {
  const writer = createHeadlessEditor({ nodes: [HeadlessExcalidrawNode] });
  writer.update(
    () => {
      // Saved earlier, so it does not open its editor on load.
      const drawing = HeadlessExcalidrawNode.$createExcalidrawNode(false);
      drawing.setData(JSON.stringify({ elements, appState: {}, files: {} }));
      $getRoot().append(drawing);
    },
    { discrete: true },
  );
  return JSON.stringify(writer.getEditorState());
}

let editor: LexicalEditor | undefined;
function Capture() {
  [editor] = useLexicalComposerContext();
  return null;
}

async function mountDrawing({ editable }: { editable: boolean }) {
  const view = await render(
    <LexicalComposer
      initialConfig={{
        namespace: "drawing-test",
        nodes: [ExcalidrawNode],
        editable,
        editorState: saved([]),
        onError: (error) => {
          throw error;
        },
      }}
    >
      <Capture />
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        ErrorBoundary={LexicalErrorBoundary}
      />
    </LexicalComposer>,
  );
  // The component loads lazily.
  for (let tries = 0; tries < 25; tries++)
    await act(() => new Promise((settle) => setTimeout(settle, 20)));
  return view;
}

const selected = () =>
  editor?.getEditorState().read(() => {
    const selection = $getSelection();
    return $isNodeSelection(selection)
      ? selection.getNodes().map((node) => node.getType())
      : [];
  });

test("an empty drawing shows a writer a placeholder to select and open", async () => {
  const view = await mountDrawing({ editable: true });
  expect(
    document.querySelector('[role="dialog"][aria-label="Drawing editor"]'),
  ).toBeNull();
  const placeholder = [
    ...document.querySelectorAll<HTMLElement>("[data-lexical-decorator] *"),
  ].find((element) => element.textContent === "Empty drawing");
  expect(placeholder).toBeDefined();

  await act(async () => placeholder?.click());
  expect(selected()).toEqual(["excalidraw"]);

  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('button[aria-label="Edit drawing"]')
      ?.click(),
  );
  expect(
    document.querySelector('[role="dialog"][aria-label="Drawing editor"]'),
  ).not.toBeNull();
  await view.unmount();
});

test("a reader sees nothing of an empty drawing", async () => {
  const view = await mountDrawing({ editable: false });
  expect(
    document.querySelector("[data-lexical-decorator]")?.textContent ?? "",
  ).toBe("");
  await view.unmount();
});
