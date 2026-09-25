/// <reference types="bun" />
import { installDom, render } from "~/test/dom";

installDom();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";

// The canvas itself is Excalidraw's; here it is one control to reach.
mock.module("@excalidraw/excalidraw", () => ({
  Excalidraw: () => (
    <button type="button" aria-label="Rectangle">
      Rectangle
    </button>
  ),
  CaptureUpdateAction: {},
  getCommonBounds: () => [0, 0, 0, 0],
}));
mock.module("@excalidraw/excalidraw/index.css", () => ({}));
mock.module("./ExcalidrawMenu", () => ({ DrawingBoardMenu: () => null }));
mock.module("~/app/drawings/[drawingId]/use-synced-excalidraw", () => ({
  useSyncedExcalidraw: () => ({ needsSave: () => false }),
}));
mock.module("~/app/drawings/[drawingId]/use-fit-on-open", () => ({
  useFitOnOpen: () => {},
}));
mock.module("../../context/document-title-context", () => ({
  useDocumentTitle: () => "Field notes",
}));

const { default: DrawingEditor } = await import("./ExcalidrawModal");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function open() {
  const opener = document.createElement("button");
  opener.textContent = "Edit drawing";
  document.body.append(opener);
  opener.focus();
  const view = await render(
    <DrawingEditor
      isShown
      initialElements={[]}
      initialAppState={{} as never}
      initialFiles={{}}
      onClose={() => {}}
      onDelete={() => {}}
      onSave={() => {}}
    />,
  );
  unmount = async () => {
    await view.unmount();
    opener.remove();
  };
  return { opener, view };
}

async function tab(shift = false) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("drawing editor", () => {
  test("is a dialog named for the document it draws in", async () => {
    await open();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const label = document.getElementById(
      dialog?.getAttribute("aria-labelledby") ?? "",
    );
    expect(label?.textContent).toBe("Drawing in Field notes");
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  test("Tab stays inside it, both ways round", async () => {
    await open();
    const dialog = document.querySelector('[role="dialog"]');
    const controls = [
      ...(dialog?.querySelectorAll<HTMLElement>("button") ?? []),
    ];
    const last = controls[controls.length - 1];
    await act(async () => last?.focus());
    await tab();
    expect(document.activeElement).toBe(controls[0] ?? null);
    await tab(true);
    expect(document.activeElement).toBe(last ?? null);
  });

  test("closing it hands focus back to what opened it", async () => {
    const { opener, view } = await open();
    await view.rerender(
      <DrawingEditor
        isShown={false}
        initialElements={[]}
        initialAppState={{} as never}
        initialFiles={{}}
        onClose={() => {}}
        onDelete={() => {}}
        onSave={() => {}}
      />,
    );
    expect(document.activeElement).toBe(opener);
  });
});
