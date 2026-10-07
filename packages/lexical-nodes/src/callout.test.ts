import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  registerMarkdownShortcuts,
} from "@lexical/markdown";
import { $createQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  KEY_ENTER_COMMAND,
} from "lexical";
import { CORE_NODES, CORE_TRANSFORMERS } from "./index.js";

/** An editor holding one block that says `text`, the caret at `offset`. */
function typingIn(
  block: () => ElementNode,
  text: string,
  offset = text.length,
) {
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  registerMarkdownShortcuts(editor, CORE_TRANSFORMERS);
  editor.update(
    () => {
      const textNode = $createTextNode(text);
      $getRoot().append(block().append(textNode));
      textNode.select(offset, offset);
    },
    { discrete: true },
  );
  return editor;
}

async function type(editor: ReturnType<typeof typingIn>, text: string) {
  editor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
      selection.insertText(text);
    },
    { discrete: true },
  );
  // The shortcut runs in an update the update listener queues.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const markdownOf = (editor: ReturnType<typeof typingIn>) =>
  editor.read(() => $convertToMarkdownString(CORE_TRANSFORMERS));

describe("[!kind] typed at the start of a quote", () => {
  test("makes it a callout of that kind, the rest of the quote its first line", async () => {
    const editor = typingIn($createQuoteNode, "[!tip]Hello", 6);
    await type(editor, " ");
    await type(editor, "X");
    expect(markdownOf(editor)).toBe("> [!TIP]\n> XHello");
  });

  test.each([
    ["[!WARNING] ", "> [!WARNING]\n> Hi"],
    ["[!danger] ", "> [!CAUTION] Danger\n> Hi"],
    ["[!faq] ", "> [!IMPORTANT] Faq\n> Hi"],
    ["[!recipe] ", "> [!NOTE] Recipe\n> Hi"],
  ])("reads %p as markdown import does", async (marker, expected) => {
    const editor = typingIn($createQuoteNode, marker.trimEnd());
    await type(editor, " ");
    await type(editor, "Hi");
    expect(markdownOf(editor)).toBe(expected);
  });

  test("leaves a paragraph that says it, and imports a line that says it, as text", async () => {
    const editor = typingIn($createParagraphNode, "[!tip]");
    await type(editor, " ");
    expect(editor.read(() => $getRoot().getFirstChild()?.getType())).toBe(
      "paragraph",
    );
    editor.update(
      () => $convertFromMarkdownString("[!tip] Hello", CORE_TRANSFORMERS),
      { discrete: true },
    );
    expect(
      editor.read(() => {
        const first = $getRoot().getFirstChild();
        return [first?.getType(), first?.getTextContent()];
      }),
    ).toEqual(["paragraph", "[!tip] Hello"]);
  });
});

describe(":::kind typed at the start of a paragraph", () => {
  test("makes a callout of that kind with the caret inside", async () => {
    const editor = typingIn($createParagraphNode, ":::warning");
    await type(editor, " ");
    await type(editor, "Hi");
    expect(markdownOf(editor)).toBe("> [!WARNING]\n> Hi");
  });

  test("takes a bracketed title", async () => {
    const editor = typingIn($createParagraphNode, ":::tip[Mind the gap]");
    await type(editor, " ");
    await type(editor, "Hi");
    expect(markdownOf(editor)).toBe("> [!TIP] Mind the gap\n> Hi");
  });

  test("is finished by Enter as well as by a space", async () => {
    const editor = typingIn($createParagraphNode, ":::danger");
    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await type(editor, "Hi");
    expect(markdownOf(editor)).toBe("> [!CAUTION] Danger\n> Hi");
  });

  test("still imports an admonition left open as text", () => {
    const editor = typingIn($createParagraphNode, "");
    editor.update(
      () => $convertFromMarkdownString(":::tip\nHello", CORE_TRANSFORMERS),
      { discrete: true },
    );
    expect(markdownOf(editor)).toBe(":::tip\nHello");
  });
});
