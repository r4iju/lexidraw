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
const replaced = [
  "window",
  "document",
  "navigator",
  "MutationObserver",
] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);

let useIsDarkTheme: typeof import("./theme-provider").useIsDarkTheme;

beforeAll(async () => {
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  ({ useIsDarkTheme } = await import("./theme-provider"));
});
afterAll(() => {
  for (const [key, value] of saved) {
    // Absent before, absent after: later files shim what is missing.
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

/** Mounts a reader of the hook and returns every value it rendered with. */
async function mountReader() {
  const seen: boolean[] = [];
  function Reader() {
    seen.push(useIsDarkTheme());
    return null;
  }
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Reader />));
  return { seen, unmount: () => act(async () => root.unmount()) };
}

// The theme script has already put the class on <html> by the time anything
// mounts, so a drawing that starts light has flashed white at a dark reader.
test("a dark page renders dark from the very first render", async () => {
  dom.window.document.documentElement.className = "dark";
  const { seen, unmount } = await mountReader();
  expect(seen[0]).toBe(true);
  expect(seen.every(Boolean)).toBe(true);
  await unmount();
});

test("follows the page when the reader changes theme", async () => {
  dom.window.document.documentElement.className = "light";
  const { seen, unmount } = await mountReader();
  expect(seen.at(-1)).toBe(false);
  await act(async () => {
    dom.window.document.documentElement.className = "dark";
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(seen.at(-1)).toBe(true);
  await unmount();
});
