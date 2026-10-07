/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { LexicalEditor } from "lexical";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/documents/1",
  pretendToBeVisual: true,
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const replaced = [
  "window",
  "document",
  "navigator",
  "Event",
  "CustomEvent",
] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);
let shimmed: string[] = [];

type Modules = {
  lexical: typeof import("lexical");
  markdown: typeof import("@lexical/markdown");
  nodes: typeof import("@packages/lexical-nodes");
  composer: typeof import("@lexical/react/LexicalComposer");
  richText: typeof import("@lexical/react/LexicalRichTextPlugin");
  editable: typeof import("@lexical/react/LexicalContentEditable");
  boundary: typeof import("@lexical/react/LexicalErrorBoundary");
  context: typeof import("@lexical/react/LexicalComposerContext");
  plugin: typeof import("./index");
};
let m: Modules;

beforeAll(async () => {
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  m = {
    lexical: await import("lexical"),
    markdown: await import("@lexical/markdown"),
    nodes: await import("@packages/lexical-nodes"),
    composer: await import("@lexical/react/LexicalComposer"),
    richText: await import("@lexical/react/LexicalRichTextPlugin"),
    editable: await import("@lexical/react/LexicalContentEditable"),
    boundary: await import("@lexical/react/LexicalErrorBoundary"),
    context: await import("@lexical/react/LexicalComposerContext"),
    plugin: await import("./index"),
  };
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

let editor: LexicalEditor;

function Capture() {
  [editor] = m.context.useLexicalComposerContext();
  return null;
}

async function mount(markdown: string) {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <m.composer.LexicalComposer
        initialConfig={{
          namespace: "callout-test",
          nodes: m.nodes.CORE_NODES,
          editorState: () =>
            m.markdown.$convertFromMarkdownString(
              markdown,
              m.nodes.CORE_TRANSFORMERS,
            ),
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <m.richText.RichTextPlugin
          contentEditable={<m.editable.ContentEditable />}
          ErrorBoundary={m.boundary.LexicalErrorBoundary}
        />
        <m.plugin.default />
        <Capture />
      </m.composer.LexicalComposer>,
    );
  });
  return { container, unmount: () => act(() => root?.unmount()) };
}

const markdownOf = () =>
  editor
    .getEditorState()
    .read(() => m.markdown.$convertToMarkdownString(m.nodes.CORE_TRANSFORMERS));

async function update(fn: () => void) {
  await act(async () => {
    editor.update(fn, { discrete: true });
  });
}

// Each case runs in one update: between updates Lexical reads the caret back
// from the DOM, which a headless import earlier in the run can switch off.
describe("inserting a callout", () => {
  test("puts a callout of the chosen kind and title where the caret is, with the caret inside", async () => {
    const doc = await mount("First\n\nSecond");
    await update(() => {
      m.lexical.$getRoot().getFirstChildOrThrow().selectEnd();
      editor.dispatchCommand(m.plugin.INSERT_CALLOUT_COMMAND, {
        kind: "warning",
        title: "Mind the gap",
      });
      m.lexical.$getSelection()?.insertText("Typed inside");
    });

    expect(markdownOf()).toBe(
      "First\n\n> [!WARNING] Mind the gap\n> Typed inside\n\nSecond",
    );
    const shown = doc.container.querySelector("[data-callout-kind=warning]");
    expect(shown?.textContent).toContain("Mind the gap");
    expect(shown?.textContent).toContain("Typed inside");
    await doc.unmount();
  });

  test("Enter on an empty last line leaves the callout", async () => {
    const doc = await mount("> [!TIP]\n> One line");
    await update(() => {
      m.lexical.$getRoot().getLastDescendant()?.selectEnd();
      editor.dispatchCommand(m.lexical.INSERT_PARAGRAPH_COMMAND, undefined);
      editor.dispatchCommand(m.lexical.INSERT_PARAGRAPH_COMMAND, undefined);
      m.lexical.$getSelection()?.insertText("Outside");
    });

    expect(markdownOf()).toBe("> [!TIP]\n> One line\n\nOutside");
    await doc.unmount();
  });
});

/** Puts the caret `offset` characters into the text node that says `text`. */
function $caretIn(text: string, offset: number) {
  const node = m.lexical
    .$getRoot()
    .getAllTextNodes()
    .find((each) => each.getTextContent() === text);
  if (!node) throw new Error(`No text "${text}"`);
  node.select(offset, offset);
}

const backspace = () =>
  editor.dispatchCommand(m.lexical.DELETE_CHARACTER_COMMAND, true);

const AROUND = "Before\n\n> [!TIP] Handy\n> First\n>\n> Second\n\nAfter";

describe("Backspace at a callout's edges", () => {
  test("at the start of a callout turns it back into its blocks", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $caretIn("First", 0);
      backspace();
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe("Before\n\nXFirst\n\nSecond\n\nAfter");
    await doc.unmount();
  });

  test("at the start of the line after a callout joins it onto the callout's last line", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $caretIn("After", 0);
      backspace();
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe(
      "Before\n\n> [!TIP] Handy\n> First\n>\n> SecondXAfter",
    );
    await doc.unmount();
  });
});

const forwardDelete = () =>
  editor.dispatchCommand(m.lexical.DELETE_CHARACTER_COMMAND, false);

describe("Delete at a callout's edges", () => {
  test("at the end of the line before a callout pulls the callout's first line up", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $caretIn("Before", 6);
      forwardDelete();
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe(
      "BeforeXFirst\n\n> [!TIP] Handy\n> Second\n\nAfter",
    );
    await doc.unmount();
  });

  test("pulling up a callout's only line removes the callout", async () => {
    const doc = await mount("Before\n\n> [!NOTE]\n> Only\n\nAfter");
    await update(() => {
      $caretIn("Before", 6);
      forwardDelete();
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe("BeforeXOnly\n\nAfter");
    await doc.unmount();
  });

  test("at the end of a callout's last line pulls the next line in", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $caretIn("Second", 6);
      forwardDelete();
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe(
      "Before\n\n> [!TIP] Handy\n> First\n>\n> SecondXAfter",
    );
    await doc.unmount();
  });
});

/** Selects from `offset` into `from` to `focusOffset` into `to`. */
function $selectAcross(
  from: string,
  offset: number,
  to: string,
  focusOffset: number,
) {
  const texts = m.lexical.$getRoot().getAllTextNodes();
  const find = (text: string) => {
    const node = texts.find((each) => each.getTextContent() === text);
    if (!node) throw new Error(`No text "${text}"`);
    return node;
  };
  const selection = m.lexical.$createRangeSelection();
  selection.anchor.set(find(from).getKey(), offset, "text");
  selection.focus.set(find(to).getKey(), focusOffset, "text");
  m.lexical.$setSelection(selection);
}

describe("a selection across a callout's edge", () => {
  test("deleted from before a callout into it joins what is left", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $selectAcross("Before", 3, "First", 2);
      backspace();
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe("BefXrst\n\n> [!TIP] Handy\n> Second\n\nAfter");
    await doc.unmount();
  });

  test("deleted from a callout to after it joins what is left inside the callout", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $selectAcross("Second", 3, "After", 2);
      forwardDelete();
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe(
      "Before\n\n> [!TIP] Handy\n> First\n>\n> SecXter",
    );
    await doc.unmount();
  });

  test("typed over joins what is left", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $selectAcross("First", 2, "After", 2);
      editor.dispatchCommand(m.lexical.CONTROLLED_TEXT_INSERTION_COMMAND, "X");
    });

    expect(markdownOf()).toBe("Before\n\n> [!TIP] Handy\n> FiXter");
    await doc.unmount();
  });

  test("removed as a cut or drag removes it joins what is left", async () => {
    const doc = await mount(AROUND);
    await update(() => {
      $selectAcross("Before", 3, "Second", 2);
      editor.dispatchCommand(m.lexical.REMOVE_TEXT_COMMAND, null);
      m.lexical.$getSelection()?.insertText("X");
    });

    expect(markdownOf()).toBe("BefXcond\n\nAfter");
    await doc.unmount();
  });
});
