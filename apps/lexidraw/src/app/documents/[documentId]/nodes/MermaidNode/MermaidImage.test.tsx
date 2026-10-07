/// <reference types="bun" />
import { afterAll, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/documents/1",
  pretendToBeVisual: true,
});
const globals = globalThis as Record<string, unknown>;
const win = dom.window as unknown as Record<string, unknown>;
const replaced = ["window", "document", "navigator"] as const;
const saved = replaced.map((key) => [key, globals[key]] as const);
let shimmed: string[] = [];
let MermaidImage: typeof import("./MermaidImage").default;

beforeAll(async () => {
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom draws nothing; the diagram reads its colours through a canvas.
  dom.window.HTMLCanvasElement.prototype.getContext = (() => ({
    fillStyle: "",
    fillRect() {},
    clearRect() {},
    getImageData: () => ({ data: [0, 0, 0, 255] }),
  })) as never;
  MermaidImage = (await import("./MermaidImage")).default;
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

test("an invalid diagram shows Mermaid's message in its block and leaves nothing outside it", async () => {
  const host = document.createElement("div");
  host.id = "host";
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MermaidImage
        schema={"flowchart LR\n A -->"}
        width="inherit"
        height="inherit"
        natural={undefined}
      />,
    ),
  );
  const block = host.querySelector(".document-mermaid");
  for (
    let wait = 0;
    wait < 100 && !block?.textContent?.includes("error");
    wait++
  )
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

  expect(block?.textContent).toContain("Expecting 'AMP'");
  expect([...document.body.children].map((element) => element.id)).toEqual([
    "host",
  ]);
  await act(async () => root.unmount());
  host.remove();
});
