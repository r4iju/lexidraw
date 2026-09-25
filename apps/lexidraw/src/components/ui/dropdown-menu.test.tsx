/// <reference types="bun" />
import { installDom, openWithKeyboard, render, setScreen } from "~/test/dom";

installDom();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";

// Menus close when the route changes; there is no route here.
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} = await import("./dropdown-menu");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function openExport() {
  ({ unmount } = await render(
    <DropdownMenu>
      <DropdownMenuTrigger>Document actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Share…</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Markdown (.md)</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>,
  ));
  await openWithKeyboard(document.querySelector("button"));
  const exportItem = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.trim() === "Export");
  await act(async () => exportItem?.focus());
  await act(async () => {
    exportItem?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  const menus = document.querySelectorAll<HTMLElement>('[role="menu"]');
  return { exportItem, sub: menus[menus.length - 1] };
}

function items(menu: HTMLElement | undefined) {
  return [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) =>
    item.textContent?.trim(),
  );
}

describe("menu", () => {
  test("on a phone a submenu drills down, with a way back", async () => {
    setScreen({ width: 375 });
    const { exportItem, sub } = await openExport();
    expect(items(sub)).toEqual(["Back", "Markdown (.md)"]);
    const back = sub?.querySelector<HTMLElement>('[role="menuitem"]');
    await act(async () => back?.click());
    expect(document.querySelectorAll('[role="menu"]').length).toBe(1);
    expect(document.activeElement).toBe(exportItem ?? null);
  });

  test("beside the trigger, a submenu flies out without a back row", async () => {
    setScreen({ width: 1280 });
    const { sub } = await openExport();
    expect(items(sub)).toEqual(["Markdown (.md)"]);
  });

  for (const [pointer, coarse] of [
    ["finger", true],
    ["mouse", false],
  ] as const) {
    test(`on a phone a ${pointer} opens it on release, so the sheet under it takes no tap`, async () => {
      setScreen({ width: 375, coarse });
      ({ unmount } = await render(
        <DropdownMenu>
          <DropdownMenuTrigger>Insert</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Table</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      ));
      const trigger = document.querySelector("button");
      // jsdom has no PointerEvent; a mouse event carries the pointer type.
      const press = new window.MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      Object.defineProperty(press, "pointerType", {
        value: coarse ? "touch" : "mouse",
      });
      await act(async () => {
        trigger?.dispatchEvent(press);
      });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await act(async () => trigger?.click());
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
    });
  }
});
