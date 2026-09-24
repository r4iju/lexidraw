/// <reference types="bun" />
import { afterAll, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/documents/1",
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const replaced = ["window", "document", "navigator"] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);

let settings: typeof import("./document-settings-context");

beforeAll(async () => {
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  settings = await import("./document-settings-context");
});
afterAll(() => {
  for (const [key, value] of saved) globals[key] = value;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

test("changing the document's language or font is a change autosave hears of", async () => {
  const heard: string[] = [];
  let context: ReturnType<typeof settings.useDocumentSettings> | undefined;
  function Editor() {
    context = settings.useDocumentSettings();
    settings.useDocumentSettingsChange(() =>
      heard.push(`${context?.lang}/${context?.defaultFontFamily}`),
    );
    return null;
  }
  const root = createRoot(dom.window.document.createElement("div"));
  await act(async () =>
    root.render(
      <settings.DocumentSettingsProvider initialLang="en">
        <Editor />
      </settings.DocumentSettingsProvider>,
    ),
  );
  // Opening the document changes nothing.
  expect(heard).toEqual([]);

  await act(async () => context?.setLang("ja"));
  await act(async () => context?.setLang("ko"));
  await act(async () => context?.setDefaultFontFamily("serif"));
  expect(heard).toEqual(["ja/null", "ko/null", "ko/serif"]);

  // Choosing what it already is changes nothing either.
  await act(async () => context?.setLang("ko"));
  expect(heard).toHaveLength(3);
  await act(async () => root.unmount());
});
