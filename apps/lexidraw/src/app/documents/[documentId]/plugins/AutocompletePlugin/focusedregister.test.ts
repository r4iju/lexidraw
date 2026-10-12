import { expect, test } from "bun:test";
import { installDom } from "~/test/dom";

installDom();
window.Range.prototype.getBoundingClientRect = () =>
  new window.DOMRect(0, 0, 0, 0);

const {
  createEditor,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $createParagraphNode,
  $createTextNode,
} = await import("lexical");
const { registerAutocomplete } = await import("./register");
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));

test("an update after outside focus does not request or paint a suggestion", async () => {
  const editor = createEditor({
    namespace: "unfocused-editor-contract",
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  root.tabIndex = 0;
  const outside = document.createElement("button");
  document.body.append(root, outside);
  editor.setRootElement(root);
  root.focus();

  const requests: { before: string; active: string }[] = [];
  const stop = registerAutocomplete(editor, {
    title: "",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: async (input) => {
      requests.push({
        before: input.before,
        active: document.activeElement === root ? "editor" : "outside",
      });
      return " world";
    },
  });
  const selection = () =>
    editor.getEditorState().read(() => {
      const value = $getSelection();
      return $isRangeSelection(value)
        ? { collapsed: value.isCollapsed(), offset: value.anchor.offset }
        : null;
    });

  editor.update(
    () => {
      const text = $createTextNode("Hello");
      $getRoot().append($createParagraphNode().append(text));
      text.selectEnd();
    },
    { discrete: true },
  );
  await pause();
  expect(requests).toEqual([{ before: "Hello", active: "editor" }]);
  expect(root.textContent).toBe("Hello");
  expect(
    root.querySelector("[data-suggestion]")?.getAttribute("data-suggestion"),
  ).toBe(" world");

  outside.focus();
  await pause();
  expect(document.activeElement).toBe(outside);
  expect(selection()).toEqual({ collapsed: true, offset: 5 });
  expect(root.querySelector("[data-suggestion]")).toBeNull();

  editor.update(
    () => {
      const paragraph = $getRoot().getFirstChild();
      if ($isElementNode(paragraph)) paragraph.setIndent(1);
    },
    { discrete: true },
  );
  await pause();
  expect(document.activeElement).toBe(outside);
  expect(selection()).toEqual({ collapsed: true, offset: 5 });
  expect(root.textContent).toBe("Hello");
  expect(requests).toEqual([{ before: "Hello", active: "editor" }]);
  expect(root.querySelector("[data-suggestion]")).toBeNull();

  root.focus();
  editor.update(
    () => {
      const paragraph = $getRoot().getFirstChild();
      if ($isElementNode(paragraph)) {
        paragraph.setIndent(0);
        const text = paragraph.getFirstChild();
        if ($isTextNode(text)) text.selectEnd();
      }
    },
    { discrete: true },
  );
  await pause();
  expect(requests).toEqual([
    { before: "Hello", active: "editor" },
    { before: "Hello", active: "editor" },
  ]);
  expect(root.textContent).toBe("Hello");
  expect(
    root.querySelector("[data-suggestion]")?.getAttribute("data-suggestion"),
  ).toBe(" world");

  stop();
  editor.setRootElement(null);
  root.remove();
  outside.remove();
});
