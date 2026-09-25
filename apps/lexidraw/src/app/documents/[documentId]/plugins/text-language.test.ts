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
  language: typeof import("./text-language");
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
    language: await import("./text-language"),
  };
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
});

function mount(markdown: string, lang: string) {
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.append(root);
  const editor: LexicalEditor = m.lexical.createEditor({
    namespace: "text-language-test",
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
  const stop = m.language.registerTextLanguage(editor, lang);
  return { editor, root, stop };
}

const spans = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("[data-lexical-text]")].map(
    (span) => [span.textContent, span.lang || null] as const,
  );

describe("Japanese inside a document in another language", () => {
  test("text with kana says it is Japanese, so it breaks between phrases", () => {
    const { root } = mount(
      "## サーモンのレモンハーブグリル\n\n| Dish | 日本語 |\n| --- | --- |\n| Salmon | バスクチーズケーキ |\n\nPlain English.",
      "en",
    );
    expect(spans(root)).toEqual([
      ["サーモンのレモンハーブグリル", "ja"],
      ["Dish", null],
      ["日本語", null],
      ["Salmon", null],
      ["バスクチーズケーキ", "ja"],
      ["Plain English.", null],
    ]);
  });

  test("a Japanese document marks nothing, and an edit is marked again", () => {
    const ja = mount("## サーモンのグリル", "ja");
    expect(spans(ja.root)).toEqual([["サーモンのグリル", null]]);

    const en = mount("Salmon", "en");
    en.editor.update(
      () => {
        const text = m.lexical.$getRoot().getFirstDescendant();
        if (m.lexical.$isTextNode(text)) text.setTextContent("鮭のグリル");
      },
      { discrete: true },
    );
    expect(spans(en.root)).toEqual([["鮭のグリル", "ja"]]);
  });
});
