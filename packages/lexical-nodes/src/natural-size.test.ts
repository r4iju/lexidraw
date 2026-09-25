/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot, $isDecoratorNode, type LexicalNode } from "lexical";
import {
  $getNaturalSize,
  $setNaturalSize,
  CORE_NODES,
  ImageNode,
  MermaidNode,
} from "./index.js";

function editor() {
  return createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

/** Saves a document holding `create()`'s block, and opens the save again. */
function reopened(create: () => LexicalNode) {
  const writer = editor();
  writer.update(
    () => {
      $getRoot().append(create());
    },
    { discrete: true },
  );
  const saved = JSON.stringify(writer.getEditorState());
  const reader = editor();
  reader.setEditorState(reader.parseEditorState(saved));
  return reader.getEditorState().read(() => {
    const block = $getRoot().getFirstDescendant() ?? $getRoot().getFirstChild();
    if (!$isDecoratorNode(block)) throw new Error("No block");
    return $getNaturalSize(block);
  });
}

describe("a figure's natural size", () => {
  test("an image and a diagram keep the size they were measured at", () => {
    const image = () => {
      const node = ImageNode.$createImageNode({ src: "/a.png", altText: "" });
      $setNaturalSize(node, { width: 2804, height: 1882 });
      return node;
    };
    const diagram = () => {
      const node = MermaidNode.$createMermaidNode("graph TD; A-->B");
      $setNaturalSize(node, { width: 120, height: 310.5 });
      return node;
    };
    expect(reopened(image)).toEqual({ width: 2804, height: 1882 });
    expect(reopened(diagram)).toEqual({ width: 120, height: 310.5 });
  });

  test("a block that was never measured, or measured as nothing, has none", () => {
    expect(
      reopened(() =>
        ImageNode.$createImageNode({ src: "/a.png", altText: "" }),
      ),
    ).toBeUndefined();
    expect(
      reopened(() => {
        const node = ImageNode.$createImageNode({ src: "/a.png", altText: "" });
        $setNaturalSize(node, { width: 0, height: 0 });
        return node;
      }),
    ).toBeUndefined();
  });

  test("a diagram's size goes with the source it was drawn from", () => {
    const writer = editor();
    let kept: unknown;
    let dropped: unknown;
    writer.update(
      () => {
        const node = MermaidNode.$createMermaidNode("graph TD; A-->B");
        $setNaturalSize(node, { width: 120, height: 310.5 });
        $getRoot().append(node);
        node.setSchema("graph TD; A-->B");
        kept = $getNaturalSize(node);
        node.setSchema("graph TD; A-->B-->C");
        dropped = $getNaturalSize(node);
      },
      { discrete: true },
    );
    expect(kept).toEqual({ width: 120, height: 310.5 });
    expect(dropped).toBeUndefined();
  });
});
