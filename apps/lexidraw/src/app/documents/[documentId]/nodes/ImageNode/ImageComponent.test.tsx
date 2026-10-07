/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ImageNode as HeadlessImageNode } from "@packages/lexical-nodes";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  type LexicalEditor,
} from "lexical";
import { act } from "react";
import { click, installDom, render } from "~/test/dom";
import { SettingsProvider } from "../../context/settings-context";
import { ImageNode } from "./ImageNode";

installDom("https://app.test/documents/1");

/** A saved document of one paragraph holding one image at `src`. */
function saved(src: string) {
  const writer = createHeadlessEditor({ nodes: [HeadlessImageNode] });
  writer.update(
    () => {
      const image = HeadlessImageNode.$createImageNode({
        src,
        altText: "Harbour",
      });
      $getRoot().append($createParagraphNode().append(image));
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

async function mountImage(src: string) {
  const view = await render(
    <SettingsProvider>
      <LexicalComposer
        initialConfig={{
          namespace: "image-test",
          nodes: [ImageNode],
          editorState: saved(src),
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
      </LexicalComposer>
    </SettingsProvider>,
  );
  // The component loads lazily.
  for (let tries = 0; tries < 50 && !document.querySelector("img"); tries++)
    await act(() => new Promise((settle) => setTimeout(settle, 20)));
  return view;
}

const selectedImage = () =>
  editor?.getEditorState().read(() => {
    const selection = $getSelection();
    return $isNodeSelection(selection)
      ? selection.getNodes().map((node) => node.getType())
      : [];
  });

test("an image that failed to load is selected by clicking its placeholder", async () => {
  const view = await mountImage("https://app.test/missing.png");
  const image = document.querySelector("img");
  await act(async () => {
    image?.dispatchEvent(new window.Event("error"));
  });
  const placeholder = document.querySelector('[role="img"][aria-label]');
  expect(placeholder?.textContent).toContain("Image unavailable");

  await click(placeholder);
  expect(selectedImage()).toEqual(["image"]);
  await view.unmount();
});
