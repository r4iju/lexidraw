/// <reference types="bun" />
import { afterAll, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/",
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const saved = { window: globals.window, document: globals.document };
let shimmed: string[] = [];

beforeAll(() => {
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  globals.window = win;
  globals.document = dom.window.document;
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  Object.assign(globals, saved);
});

/** The DOM the document editor renders for stored `children` of a paragraph. */
async function rendered(children: object[]): Promise<HTMLElement> {
  const { createEditor } = await import("lexical");
  const { CORE_NODES } = await import("@packages/lexical-nodes");
  const { theme } = await import("./theme");
  const editor = createEditor({
    nodes: CORE_NODES,
    theme,
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement("div");
  root.contentEditable = "true";
  editor.setRootElement(root);
  editor.setEditorState(
    editor.parseEditorState({
      root: {
        type: "root",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
        children: [
          {
            type: "paragraph",
            version: 1,
            format: "",
            indent: 0,
            direction: null,
            children,
          },
        ],
      },
    } as never),
  );
  return root;
}

const leaf = (type: string, text: string) => ({
  type,
  version: 1,
  text,
  detail: 0,
  format: 0,
  mode: "normal",
  style: "",
});

test("a hashtag and a keyword take their classes from the document theme", async () => {
  const { theme } = await import("./theme");
  const root = await rendered([
    leaf("hashtag", "#lexidraw"),
    leaf("text", " "),
    leaf("keyword", "congrats"),
  ]);
  const [hashtag, , keyword] = root.querySelectorAll("p > span");
  expect(theme.hashtag).toBeString();
  expect(theme.keyword).toBeString();
  expect(hashtag?.className).toBe(theme.hashtag);
  expect(keyword?.className).toBe(`keyword ${theme.keyword}`);
});
