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
    setScreen({ width: 1280 });
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

/**
 * A screen for `matchMedia`, which jsdom lacks: its width and whether the
 * pointer is a finger. Answers the width, pointer and hover queries the app
 * asks; anything else does not match. A file starts on a desktop with a mouse.
 */
export function setScreen(screen: { width: number; coarse?: boolean }) {
  const current = { coarse: false, ...screen };
  const answer = (query: string) => {
    const width = query.match(/\(width\s*(<|>=)\s*([\d.]+)rem\)/);
    if (width) {
      const px = Number(width[2]) * 16;
      return width[1] === "<" ? current.width < px : current.width >= px;
    }
    if (query.includes("pointer: coarse") || query.includes("hover: none"))
      return current.coarse;
    if (query.includes("pointer: fine") || query.includes("hover: hover"))
      return !current.coarse;
    return false;
  };
  (window as unknown as { matchMedia: unknown }).matchMedia = (
    query: string,
  ) => ({
    get matches() {
      return answer(query);
    },
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  (window as unknown as { innerWidth: number }).innerWidth = current.width;
  return (next: { width: number; coarse?: boolean }) =>
    Object.assign(current, { coarse: false, ...next });
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
