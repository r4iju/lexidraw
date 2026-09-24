/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { LexicalEditor, NodeKey } from "lexical";
import { act, useEffect, useState } from "react";
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
  nodes: typeof import("@packages/lexical-nodes");
  composer: typeof import("@lexical/react/LexicalComposer");
  context: typeof import("@lexical/react/LexicalComposerContext");
  figure: typeof import("./Figure");
};
let m: Modules;

beforeAll(async () => {
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  // React chose how to watch text fields when it first loaded, before any
  // window existed, and took the old path that needs these.
  const element = (dom.window.HTMLElement.prototype ?? {}) as unknown as Record<
    string,
    unknown
  >;
  element.attachEvent ??= () => {};
  element.detachEvent ??= () => {};
  m = {
    lexical: await import("lexical"),
    nodes: await import("@packages/lexical-nodes"),
    composer: await import("@lexical/react/LexicalComposer"),
    context: await import("@lexical/react/LexicalComposerContext"),
    figure: await import("./Figure"),
  };
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

let editor: LexicalEditor;
let key: NodeKey;

function Capture() {
  [editor] = m.context.useLexicalComposerContext();
  return null;
}

/** The frame as a diagram's decorate() would draw it, redrawn on change. */
function Frame() {
  const [composer] = m.context.useLexicalComposerContext();
  const [figure, setFigure] = useState(() =>
    composer.read(() =>
      m.nodes.$getFigure(m.lexical.$getNodeByKey(key) ?? m.lexical.$getRoot()),
    ),
  );
  useEffect(
    () =>
      composer.registerUpdateListener(({ editorState }) =>
        setFigure(
          editorState.read(() =>
            m.nodes.$getFigure(
              m.lexical.$getNodeByKey(key) ?? m.lexical.$getRoot(),
            ),
          ),
        ),
      ),
    [composer],
  );
  return (
    <m.figure.FigureFrame nodeKey={key} figure={figure}>
      <div>diagram</div>
    </m.figure.FigureFrame>
  );
}

async function mount({ editable = true, selected = true } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <m.composer.LexicalComposer
        initialConfig={{
          namespace: "figure-test",
          nodes: m.nodes.CORE_NODES,
          editable,
          editorState: () => {
            const diagram = m.nodes.MermaidNode.$createMermaidNode("graph TD");
            m.lexical.$getRoot().append(diagram);
            key = diagram.getKey();
            if (selected) {
              const selection = m.lexical.$createNodeSelection();
              selection.add(key);
              m.lexical.$setSelection(selection);
            }
          },
          onError: (error: Error) => {
            throw error;
          },
        }}
      >
        <Capture />
        <Frame />
      </m.composer.LexicalComposer>,
    );
  });
  return { container, unmount: () => act(() => root?.unmount()) };
}

const figureNow = () =>
  editor
    .getEditorState()
    .read(() =>
      m.nodes.$getFigure(m.lexical.$getNodeByKey(key) ?? m.lexical.$getRoot()),
    );

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name ||
      candidate.textContent === name,
  );

describe("a figure's frame", () => {
  test("a selected figure offers its widths, and choosing one sets it", async () => {
    const { container, unmount } = await mount();
    await act(async () => button(container, "Wide")?.click());
    expect(figureNow().width).toBe("wide");
    expect(button(container, "Wide")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    await act(async () => button(container, "50%")?.click());
    expect(figureNow().width).toBe("50%");
    await act(async () => button(container, "Column")?.click());
    expect(figureNow().width).toBeUndefined();
    await unmount();
  });

  test("a caption is added, written below the figure, and removed when emptied", async () => {
    const { container, unmount } = await mount();
    await act(async () => button(container, "Caption")?.click());
    const write = (text: string) =>
      act(async () => {
        const field = container.querySelector<HTMLTextAreaElement>(
          ".document-caption textarea",
        );
        if (!field) throw new Error("no caption field");
        field.value = text;
        field.focus();
        field.blur();
      });
    await write("Flow of an order");
    expect(figureNow().caption).toBe("Flow of an order");
    expect(container.querySelector("textarea")?.value).toBe("Flow of an order");

    await write("  ");
    expect(figureNow().caption).toBeUndefined();
    expect(container.querySelector(".document-caption")).toBeNull();
    await unmount();
  });

  test("a reader sees the caption as text and no controls", async () => {
    const { container, unmount } = await mount({ editable: false });
    await act(async () => {
      editor.setEditable(true);
      editor.update(
        () => {
          const node = m.lexical.$getNodeByKey(key);
          if (node) m.nodes.$setFigure(node, { caption: "Order flow" });
        },
        { discrete: true },
      );
      editor.setEditable(false);
    });
    expect(container.querySelector(".document-caption")?.textContent).toBe(
      "Order flow",
    );
    expect(container.querySelector("textarea")).toBeNull();
    expect(button(container, "Wide")).toBeUndefined();
    await unmount();
  });
});
