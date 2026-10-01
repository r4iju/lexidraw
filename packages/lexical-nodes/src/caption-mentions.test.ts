import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import { ImageNode } from "./nodes/ImageNode.js";
import { InlineImageNode } from "./nodes/InlineImageNode.js";
import { $createMentionNode } from "./nodes/MentionNode.js";

for (const kind of ["image", "inline-image"] as const) {
  test(`${kind} caption accepts the mention its mounted plugin creates`, () => {
    const parent = createHeadlessEditor({
      nodes: [ImageNode, InlineImageNode],
    });
    let caption: LexicalEditor | undefined;
    parent.update(
      () => {
        const node =
          kind === "image"
            ? ImageNode.$createImageNode({ src: "", altText: "" })
            : InlineImageNode.$createInlineImageNode({ src: "", altText: "" });
        caption = node.__caption;
        $getRoot().append($createParagraphNode().append(node));
      },
      { discrete: true },
    );
    if (!caption) throw new Error("Caption was not constructed");
    caption.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createMentionNode("Aayla Secura")),
        );
      },
      { discrete: true },
    );
    expect(
      caption.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("Aayla Secura");
  });
}
