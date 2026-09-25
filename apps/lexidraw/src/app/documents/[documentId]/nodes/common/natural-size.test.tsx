/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNaturalSize,
  $setNaturalSize,
  ImageNode,
  MermaidNode,
  type NaturalSize,
} from "@packages/lexical-nodes";
import {
  $createParagraphNode,
  $getRoot,
  $isDecoratorNode,
  type LexicalEditor,
} from "lexical";
import { useEffect } from "react";
import { installDom, render } from "~/test/dom";
import { useKeepNaturalSize } from "./natural-size";

installDom();

const STORED = { width: 120, height: 310 };
const MEASURED = { width: 124, height: 312 };
const NODES = [MermaidNode, ImageNode];

/** The document's one block. */
function $block() {
  const block = $getRoot().getFirstDescendant() ?? $getRoot().getFirstChild();
  if (!$isDecoratorNode(block)) throw new Error("No block");
  return block;
}

/** A saved document holding `create()`'s block, measured at STORED. */
function saved(create: () => MermaidNode | ImageNode) {
  const writer = createHeadlessEditor({ nodes: NODES });
  writer.update(
    () => {
      const node = create();
      $setNaturalSize(node, STORED);
      $getRoot().append(
        node instanceof ImageNode ? $createParagraphNode().append(node) : node,
      );
    },
    { discrete: true },
  );
  return JSON.stringify(writer.getEditorState());
}

/** Measures the document's one block at `size`, as a component drawing it does. */
function Measure({
  size,
  replace,
  done,
}: {
  size: NaturalSize;
  replace?: boolean;
  done: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const key = editor.getEditorState().read(() => $block().getKey());
  const keep = useKeepNaturalSize(key, { replace });
  useEffect(() => {
    keep(size);
    setTimeout(() => done(editor), 0);
  }, [keep, size, editor, done]);
  return null;
}

async function measured(
  create: () => MermaidNode | ImageNode,
  replace?: boolean,
) {
  let editor: LexicalEditor | undefined;
  const view = await render(
    <LexicalComposer
      initialConfig={{
        namespace: "test",
        nodes: NODES,
        onError: (error) => {
          throw error;
        },
        editorState: saved(create),
      }}
    >
      <Measure
        size={MEASURED}
        replace={replace}
        done={(value) => {
          editor = value;
        }}
      />
    </LexicalComposer>,
  );
  await new Promise((settle) => setTimeout(settle, 20));
  const size = editor?.getEditorState().read(() => $getNaturalSize($block()));
  await view.unmount();
  return size;
}

test("a diagram drawn again at another size keeps the size it has; a picture takes the new one", async () => {
  expect(
    await measured(
      () => MermaidNode.$createMermaidNode("graph TD; A-->B"),
      false,
    ),
  ).toEqual(STORED);
  expect(
    await measured(() =>
      ImageNode.$createImageNode({ src: "/a.png", altText: "" }),
    ),
  ).toEqual(MEASURED);
});
