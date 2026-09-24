/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
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
let Modal: typeof import("./ImportMarkdownModal").default;

beforeAll(async () => {
  shimmed = Object.getOwnPropertyNames(win).filter((key) => !(key in globals));
  for (const key of shimmed) globals[key] = win[key];
  for (const key of replaced) globals[key] = win[key];
  globals.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  Modal = (await import("./ImportMarkdownModal")).default;
});
afterAll(() => {
  for (const key of shimmed) delete globals[key];
  for (const [key, value] of saved) globals[key] = value;
  delete globals.ResizeObserver;
  delete globals.IS_REACT_ACT_ENVIRONMENT;
});

async function open(onConfirm: (mode: string) => void = () => {}) {
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      <Modal
        isOpen
        onOpenChange={() => {}}
        markdown={"# Hello\n\n> [!TIP]\n> A callout."}
        onConfirm={onConfirm}
        canEdit
      />,
    );
  });
  return {
    radio: (name: string) =>
      [
        ...document.querySelectorAll<HTMLInputElement>("input[type=radio]"),
      ].find((input) => input.labels?.[0]?.textContent?.includes(name)),
    unmount: () => act(() => root?.unmount()),
  };
}

describe("Import Markdown dialog", () => {
  test("offers the three modes as one radio group", async () => {
    const dialog = await open();
    const radios =
      document.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect([...radios].map((radio) => radio.labels?.[0]?.textContent)).toEqual([
      expect.stringContaining("Insert at start"),
      expect.stringContaining("Insert at end"),
      expect.stringContaining("Replace document"),
    ]);
    expect(new Set([...radios].map((radio) => radio.name)).size).toBe(1);
    expect(dialog.radio("Insert at end")?.checked).toBe(true);
    await dialog.unmount();
  });

  test("the primary button names the mode, and replacing is destructive", async () => {
    const chosen: string[] = [];
    const dialog = await open((mode) => chosen.push(mode));
    const button = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
    expect(button("Insert at end")?.dataset.variant).toBe("default");

    await act(async () => dialog.radio("Replace document")?.click());

    const replace = button("Replace document");
    expect(replace?.dataset.variant).toBe("destructive-confirm");
    expect(button("Insert at end")).toBeUndefined();
    await act(async () => replace?.click());
    expect(chosen).toEqual(["replace"]);
    await dialog.unmount();
  });

  test("the preview renders callouts", async () => {
    const dialog = await open();
    expect(document.body.textContent).toContain("A callout.");
    expect(
      document.querySelector("[data-callout-kind=tip]")?.textContent,
    ).toContain("A callout.");
    await dialog.unmount();
  });
});
