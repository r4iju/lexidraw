/// <reference types="bun" />
import { afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Gives the calling test file a browser document for the whole file, and puts
 * the globals back afterwards: `bun test` runs every file in one process, so a
 * leaked `window` would change what the next file's imports see.
 *
 * The globals go in straight away rather than in `beforeAll`, so the file's
 * own top-level imports already see a document.
 */
export function installDom(url = "https://app.test/") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url,
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
  const shimmed = Object.getOwnPropertyNames(win).filter(
    (key) => !(key in globals),
  );
  {
    for (const key of shimmed) globals[key] = win[key];
    for (const key of replaced) globals[key] = win[key];
    globals.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // Radix menus and selects measure and capture the pointer.
    const element = dom.window.HTMLElement.prototype as unknown as Record<
      string,
      unknown
    >;
    element.scrollIntoView ??= () => {};
    element.hasPointerCapture ??= () => false;
    element.releasePointerCapture ??= () => {};
    globals.IS_REACT_ACT_ENVIRONMENT = true;
  }
  afterAll(async () => {
    // Radix hands focus back on a timer after closing; let those run first.
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const key of shimmed) delete globals[key];
    for (const [key, value] of saved) globals[key] = value;
    delete globals.ResizeObserver;
    delete globals.IS_REACT_ACT_ENVIRONMENT;
  });
}

export async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    rerender: (next: ReactNode) => act(async () => root?.render(next)),
    unmount: async () => {
      await act(async () => root?.unmount());
      container.remove();
    },
  };
}

/** The button whose visible text is `label`. */
export function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

/** Opens a Radix menu or select trigger the way a keyboard user does. */
export async function openWithKeyboard(trigger: Element | null | undefined) {
  if (!trigger) throw new Error("no trigger to open");
  await act(async () => {
    trigger.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

export async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click");
  await act(async () => {
    (element as HTMLElement).click();
  });
}

/** Types into a React-controlled input. */
export async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
