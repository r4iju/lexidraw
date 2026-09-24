/// <reference types="bun" />
import { afterAll, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/drawings/1",
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const replaced = ["window", "document", "navigator"] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);

let useSaveShortcut: typeof import("./use-save-shortcut").useSaveShortcut;

beforeAll(async () => {
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  ({ useSaveShortcut } = await import("./use-save-shortcut"));
});
afterAll(() => {
  for (const [key, value] of saved) globals[key] = value;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

function press(init: KeyboardEventInit) {
  const event = new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  dom.window.document.body.dispatchEvent(event);
  return event;
}

test("Cmd+S and Ctrl+S save, instead of the browser or the canvas", async () => {
  let saves = 0;
  let reachedPage = 0;
  function Editor() {
    useSaveShortcut(() => saves++);
    return null;
  }
  dom.window.document.body.addEventListener("keydown", () => reachedPage++);
  const root = createRoot(dom.window.document.createElement("div"));
  await act(async () => root.render(<Editor />));

  const cmd = press({ key: "s", code: "KeyS", metaKey: true });
  expect(saves).toBe(1);
  expect(cmd.defaultPrevented).toBe(true);
  press({ key: "S", code: "KeyS", ctrlKey: true });
  expect(saves).toBe(2);
  expect(reachedPage).toBe(0);

  // Shift makes it something else: strikethrough in a document.
  press({ key: "s", code: "KeyS", metaKey: true, shiftKey: true });
  press({ key: "s", code: "KeyS" });
  expect(saves).toBe(2);

  await act(async () => root.unmount());
  press({ key: "s", code: "KeyS", metaKey: true });
  expect(saves).toBe(2);
});
