/// <reference types="bun" />
import { installDom } from "~/test/dom";

installDom("https://app.test/documents/1");

import { describe, expect, mock, test } from "bun:test";
import type { LexicalEditor } from "lexical";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// The language list opens in a popover, which closes when the route changes.
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const markdown = await import("@lexical/markdown");
const lexical = await import("lexical");
const nodes = await import("@packages/lexical-nodes");
const { LexicalComposer } = await import("@lexical/react/LexicalComposer");
const { RichTextPlugin } = await import("@lexical/react/LexicalRichTextPlugin");
const { ContentEditable } = await import(
  "@lexical/react/LexicalContentEditable"
);
const { LexicalErrorBoundary } = await import(
  "@lexical/react/LexicalErrorBoundary"
);
const { useLexicalComposerContext } = await import(
  "@lexical/react/LexicalComposerContext"
);
const { default: CodeActionMenuPlugin } = await import("./index");

let editor: LexicalEditor;

function Capture() {
  [editor] = useLexicalComposerContext();
  return null;
}

async function mount(source: string, { editable = true } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LexicalComposer
        initialConfig={{
          namespace: "code-controls-test",
          nodes: nodes.CORE_NODES,
          editable,
          editorState: () =>
            markdown.$convertFromMarkdownString(
              source,
              nodes.CORE_TRANSFORMERS,
            ),
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <CodeActionMenuPlugin />
        <Capture />
      </LexicalComposer>,
    );
  });
  return {
    blocks: () => [
      ...container.querySelectorAll<HTMLElement>(".document-code"),
    ],
    unmount: async () => {
      await act(async () => root?.unmount());
      container.remove();
    },
  };
}

/** The accessible names of a block's controls, in the order they appear. */
function controls(block: HTMLElement) {
  return [...block.querySelectorAll<HTMLElement>("button, select, input")].map(
    (control) => control.getAttribute("aria-label"),
  );
}

describe("code block controls", () => {
  test("every language offers the same controls in the same order", async () => {
    const doc = await mount(
      "```typescript\nconst a = 1;\n```\n\n```python\nx = 1\n```\n\n```\nplain\n```",
    );
    expect(doc.blocks().map(controls)).toEqual([
      ["Code language", "Show line numbers", "Format code", "Copy code"],
      ["Code language", "Show line numbers", "Format code", "Copy code"],
      ["Code language", "Show line numbers", "Format code", "Copy code"],
    ]);
    const format = doc
      .blocks()
      .map(
        (block) =>
          block
            .querySelector('[aria-label="Format code"]')
            ?.getAttribute("aria-disabled") === "true",
      );
    expect(format).toEqual([false, true, true]);
    await doc.unmount();
  });

  test("Format stays reachable where Prettier cannot format, and says why", async () => {
    const doc = await mount("```python\nx  =  1\n```");
    const format = doc
      .blocks()[0]
      ?.querySelector<HTMLButtonElement>('[aria-label="Format code"]');
    expect(format?.disabled).toBe(false);
    expect(format?.title).toBe("Python cannot be formatted");
    await act(async () => format?.click());
    expect(
      editor
        .getEditorState()
        .read(() => markdown.$convertToMarkdownString(nodes.CORE_TRANSFORMERS)),
    ).toBe("```python\nx  =  1\n```");
    await doc.unmount();
  });

  test("the block holding the caret shows its controls", async () => {
    const doc = await mount("```js\none();\n```\n\n```js\ntwo();\n```");
    const shown = () =>
      doc
        .blocks()
        .map((block) =>
          block
            .querySelector(".document-code-controls")
            ?.hasAttribute("data-active"),
        );
    expect(shown()).toEqual([false, false]);
    await act(async () => {
      editor.update(() => {
        const second = lexical.$getRoot().getChildren()[1];
        if (lexical.$isElementNode(second)) second.selectEnd();
      });
    });
    expect(shown()).toEqual([false, true]);
    await doc.unmount();
  });

  test("the line numbers toggle shows its state and numbers the block", async () => {
    const doc = await mount("```js\none();\ntwo();\n```");
    const toggle = () =>
      doc
        .blocks()[0]
        ?.querySelector<HTMLElement>('[aria-label="Show line numbers"]');
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => toggle()?.click());
    expect(toggle()?.getAttribute("aria-pressed")).toBe("true");
    expect(
      editor
        .getEditorState()
        .read(() => markdown.$convertToMarkdownString(nodes.CORE_TRANSFORMERS)),
    ).toBe("```js showLineNumbers\none();\ntwo();\n```");
    await doc.unmount();
  });

  test("the language picker finds a language by name and applies it", async () => {
    const doc = await mount("```\nfn main() {}\n```");
    const picker = () =>
      doc
        .blocks()[0]
        ?.querySelector<HTMLElement>('[aria-label="Code language"]');
    expect(picker()?.textContent).toBe("Plain text");
    await act(async () => picker()?.click());
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search languages…"]',
    );
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "rus");
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const rust = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent === "Rust");
    await act(async () => rust?.click());
    expect(
      editor
        .getEditorState()
        .read(() => markdown.$convertToMarkdownString(nodes.CORE_TRANSFORMERS)),
    ).toBe("```rust\nfn main() {}\n```");
    expect(picker()?.textContent).toBe("Rust");
    await doc.unmount();
  });
});
