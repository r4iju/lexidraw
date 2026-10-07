/// <reference types="bun" />
import { afterEach, expect, mock, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $getRoot, type LexicalEditor } from "lexical";
import { act } from "react";
import { click, installDom, openWithKeyboard, render } from "~/test/dom";

installDom("https://app.test/documents/1");

// Menus close when the route changes; there is no route here.
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { StickyNode } = await import("./StickyNode");

const paragraph = (children: unknown[]) => ({
  type: "paragraph",
  version: 1,
  direction: null,
  format: "",
  indent: 0,
  textFormat: 0,
  textStyle: "",
  children,
});
const root = (children: unknown[]) => ({
  type: "root",
  version: 1,
  direction: null,
  format: "",
  indent: 0,
  children,
});

/** A saved document of one paragraph holding a pink note placed at 500, 300 when notes floated. */
const SAVED = JSON.stringify({
  root: root([
    paragraph([
      {
        type: "sticky",
        version: 1,
        color: "pink",
        xOffset: 500,
        yOffset: 300,
        caption: { editorState: { root: root([paragraph([])]) } },
      },
    ]),
  ]),
});

let editor: LexicalEditor | undefined;
function Capture() {
  [editor] = useLexicalComposerContext();
  return null;
}

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function mountNote() {
  ({ unmount } = await render(
    <LexicalComposer
      initialConfig={{
        namespace: "sticky-test",
        nodes: [StickyNode],
        editorState: SAVED,
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
  ));
  for (
    let tries = 0;
    tries < 50 && !document.querySelector(".sticky-note");
    tries++
  )
    await act(() => new Promise((settle) => setTimeout(settle, 20)));
}

/** The note as the document saves it. */
const savedNote = () =>
  editor
    ?.getEditorState()
    .read(() => $getRoot().getFirstDescendant()?.exportJSON());

test("a note's colour menu sets any of the eight colours at once, and saving keeps where it was placed", async () => {
  await mountNote();
  await openWithKeyboard(
    document.querySelector('button[aria-label="Sticky note colour"]'),
  );
  const items = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ];
  expect(items.map((item) => item.textContent?.trim())).toEqual([
    "Pink",
    "Yellow",
    "Green",
    "Blue",
    "Red",
    "Orange",
    "Purple",
    "Gray",
  ]);
  expect(items[0]?.getAttribute("aria-checked")).toBe("true");
  await click(items.find((item) => item.textContent?.trim() === "Gray"));
  expect(savedNote()).toMatchObject({
    type: "sticky",
    color: "gray",
    xOffset: 500,
    yOffset: 300,
  });
});
