/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { LexicalEditor } from "lexical";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/documents/1",
  pretendToBeVisual: true,
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const replaced = ["window", "document", "navigator"] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);
let shimmed: string[] = [];

type Modules = {
  lexical: typeof import("lexical");
  markdown: typeof import("@lexical/markdown");
  nodes: typeof import("@packages/lexical-nodes");
};
let m: Modules;

beforeAll(async () => {
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  m = {
    lexical: await import("lexical"),
    markdown: await import("@lexical/markdown"),
    nodes: await import("@packages/lexical-nodes"),
  };
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
});

function mount(markdown: string) {
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.append(root);
  const editor: LexicalEditor = m.lexical.createEditor({
    namespace: "figure-width-test",
    nodes: m.nodes.CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(root);
  editor.update(
    () =>
      m.markdown.$convertFromMarkdownString(
        markdown,
        m.nodes.CORE_TRANSFORMERS,
      ),
    { discrete: true },
  );
  return { editor, root };
}

describe("a figure's width on the page", () => {
  test("an image written wide or at a share of the column says so to the stylesheet", () => {
    const { root } = mount(
      "![Harbour](https://example.com/a.png){.wide}\n\n![Pier](https://example.com/b.png){width=40%}\n\n![Beach](https://example.com/c.png)",
    );
    const [wide, share, column] = [
      ...root.querySelectorAll<HTMLElement>("p > span"),
    ];
    expect(wide?.dataset.figureWidth).toBe("wide");
    expect(share?.dataset.figureWidth).toBe("share");
    expect(share?.style.getPropertyValue("--figure-share")).toBe("0.4");
    expect(column?.dataset.figureWidth).toBeUndefined();
  });

  test("changing the width redraws it, and the column clears it", () => {
    const { editor, root } = mount(
      "![Pier](https://example.com/b.png){width=40%}",
    );
    const image = () => root.querySelector<HTMLElement>("p > span");
    const setWidth = (width?: "full") =>
      editor.update(
        () => {
          const node = m.lexical.$getRoot().getFirstDescendant();
          if (node) m.nodes.$setFigure(node, { width });
        },
        { discrete: true },
      );

    setWidth("full");
    expect(image()?.dataset.figureWidth).toBe("full");
    expect(image()?.style.getPropertyValue("--figure-share")).toBe("");
    setWidth();
    expect(image()?.dataset.figureWidth).toBeUndefined();
  });

  test("a diagram placed wide says so too", () => {
    const { editor, root } = mount("");
    editor.update(
      () => {
        const diagram =
          m.nodes.MermaidNode.$createMermaidNode("graph TD; A-->B");
        m.nodes.$setFigure(diagram, { width: "wide" });
        m.lexical.$getRoot().clear().append(diagram);
      },
      { discrete: true },
    );
    expect(
      root.querySelector<HTMLElement>("[data-media-type]")?.dataset.figureWidth,
    ).toBe("wide");
  });
});
