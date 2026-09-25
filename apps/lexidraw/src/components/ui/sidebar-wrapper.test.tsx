/// <reference types="bun" />
import { installDom, render, setScreen } from "~/test/dom";

installDom();

import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";

const { SidebarWrapper } = await import("./sidebar-wrapper");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function openContents() {
  let closed = 0;
  ({ unmount } = await render(
    <SidebarWrapper title="Table of contents" onClose={() => closed++}>
      <button type="button">Heading one</button>
    </SidebarWrapper>,
  ));
  return () => closed;
}

async function pressEscape() {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

describe("sidebar", () => {
  for (const [device, width, coarse] of [
    ["phone", 375, true],
    ["touch tablet", 768, true],
    ["desktop", 1280, false],
  ] as const) {
    test(`on a ${device}, focus moves in and Escape closes it`, async () => {
      setScreen({ width, coarse });
      const closed = await openContents();
      const sidebar = document.querySelector(
        '[aria-label="Table of contents"]',
      );
      expect(sidebar?.contains(document.activeElement)).toBe(true);
      await pressEscape();
      expect(closed()).toBe(1);
    });
  }

  test("on a tablet it opens over the page, behind a scrim that closes it", async () => {
    setScreen({ width: 768, coarse: true });
    const closed = await openContents();
    const scrim = document.querySelector<HTMLElement>(
      '[aria-label="Close Table of contents"]:not(header *)',
    );
    expect(scrim).not.toBeNull();
    await act(async () => scrim?.click());
    expect(closed()).toBe(1);
  });

  test("on a desktop it docks beside the page, with no scrim", async () => {
    setScreen({ width: 1280 });
    await openContents();
    expect(
      document.querySelector(
        '[aria-label="Close Table of contents"]:not(header *)',
      ),
    ).toBeNull();
  });
});
