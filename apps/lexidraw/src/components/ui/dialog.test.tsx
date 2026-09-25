/// <reference types="bun" />
import { installDom, render, setScreen } from "~/test/dom";

installDom();

import { afterEach, describe, expect, test } from "bun:test";

const { Dialog, DialogContent, DialogTitle } = await import("./dialog");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

function Rename() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Rename</DialogTitle>
        <input aria-label="Name" autoFocus />
      </DialogContent>
    </Dialog>
  );
}

describe("dialog", () => {
  test("a text field waits to be tapped on a touch screen", async () => {
    setScreen({ width: 375, coarse: true });
    ({ unmount } = await render(<Rename />));
    const dialog = document.querySelector('[role="dialog"]');
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe("Name");
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  test("with a mouse, the field takes focus as the dialog opens", async () => {
    setScreen({ width: 1280 });
    ({ unmount } = await render(<Rename />));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
  });

  test("a dialog opened over another adds no second backdrop", async () => {
    setScreen({ width: 1280 });
    ({ unmount } = await render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Edit chart</DialogTitle>
          <Dialog open>
            <DialogContent>
              <DialogTitle>Discard changes?</DialogTitle>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>,
    ));
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(2);
    expect(document.querySelectorAll("[data-backdrop]").length).toBe(1);
  });
});
