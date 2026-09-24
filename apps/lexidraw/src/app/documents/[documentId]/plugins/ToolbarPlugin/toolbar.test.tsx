/// <reference types="bun" />
import { installDom, openWithKeyboard, render } from "~/test/dom";

installDom();

import { afterEach, describe, expect, mock, test } from "bun:test";
// Menus close when the route changes; there is no route here.
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
import { act } from "react";
import { BoldIcon, ItalicIcon } from "lucide-react";
const { DropdownMenuItem } = await import("~/components/ui/dropdown-menu");
const { Toolbar, ToolbarButton, ToolbarMenu } = await import("./toolbar");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function renderToolbar({ bold = false } = {}) {
  ({ unmount } = await render(
    <Toolbar
      label="Formatting"
      groups={[
        {
          id: "marks",
          label: "Text style",
          content: (
            <>
              <ToolbarButton
                label="Bold"
                shortcut="Mod+B"
                icon={BoldIcon}
                pressed={bold}
                onClick={() => {}}
              />
              <ToolbarButton
                label="Italic"
                icon={ItalicIcon}
                pressed={false}
                onClick={() => {}}
              />
            </>
          ),
        },
        {
          id: "align",
          label: "Alignment",
          content: (
            <ToolbarMenu label="Align" trigger="Align">
              <DropdownMenuItem>Left</DropdownMenuItem>
            </ToolbarMenu>
          ),
        },
      ]}
    />,
  ));
  const toolbar = document.querySelector<HTMLElement>('[role="toolbar"]');
  if (!toolbar) throw new Error("no toolbar");
  return toolbar;
}

function controls(toolbar: HTMLElement) {
  return [...toolbar.querySelectorAll<HTMLElement>("button")];
}

async function press(key: string) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
}

describe("Toolbar", () => {
  test("is one labelled toolbar that Tab enters once", async () => {
    const toolbar = await renderToolbar();
    expect(toolbar.getAttribute("aria-label")).toBe("Formatting");
    const tabbable = controls(toolbar).filter(
      (control) => control.tabIndex === 0,
    );
    expect(
      tabbable.map((control) => control.getAttribute("aria-label")),
    ).toEqual(["Bold"]);
  });

  test("arrow keys, Home and End move between controls", async () => {
    const toolbar = await renderToolbar();
    const [bold, italic, align] = controls(toolbar) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    await act(async () => bold.focus());
    await press("ArrowRight");
    expect(document.activeElement).toBe(italic);
    await press("ArrowRight");
    expect(document.activeElement).toBe(align);
    await press("ArrowRight");
    expect(document.activeElement).toBe(bold);
    await press("ArrowLeft");
    expect(document.activeElement).toBe(align);
    await press("Home");
    expect(document.activeElement).toBe(bold);
    await press("End");
    expect(document.activeElement).toBe(align);
    // The control last moved to is where Tab comes back in.
    expect(controls(toolbar).filter((c) => c.tabIndex === 0)).toEqual([align]);
  });

  test("toggles expose whether they are on", async () => {
    const toolbar = await renderToolbar({ bold: true });
    const [bold, italic] = controls(toolbar);
    expect(bold?.getAttribute("aria-pressed")).toBe("true");
    expect(italic?.getAttribute("aria-pressed")).toBe("false");
  });

  test("names each control with its shortcut for assistive technology", async () => {
    const toolbar = await renderToolbar();
    const [bold] = controls(toolbar);
    expect(bold?.getAttribute("aria-keyshortcuts")).toMatch(
      /^(Meta|Control)\+B$/,
    );
  });

  test("a menu in the toolbar opens from the keyboard", async () => {
    const toolbar = await renderToolbar();
    const align = controls(toolbar).at(-1);
    await openWithKeyboard(align);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "Left",
    );
  });
});
