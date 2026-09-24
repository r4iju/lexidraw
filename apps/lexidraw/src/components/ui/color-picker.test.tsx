/// <reference types="bun" />
import { click, installDom, render } from "~/test/dom";

installDom();

import { afterEach, describe, expect, mock, test } from "bun:test";
// Menus close when the route changes; there is no route here.
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
import { act } from "react";
const { ColorPickerButton, TEXT_COLOUR_PRESETS } = await import(
  "./color-picker"
);
const { TooltipProvider } = await import("./tooltip");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function openPicker(color: string) {
  const onChange = mock((_value: string, _skipHistory: boolean) => {});
  ({ unmount } = await render(
    <TooltipProvider>
      <ColorPickerButton
        title="Text colour"
        color={color}
        presets={TEXT_COLOUR_PRESETS}
        onChange={onChange}
      />
    </TooltipProvider>,
  ));
  await click(document.querySelector("button"));
  const menu = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!menu) throw new Error("the picker did not open");
  return { menu, onChange };
}

function selectedSwatch(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLElement>('[role="radio"]')]
    .filter((swatch) => swatch.getAttribute("aria-checked") === "true")
    .map((swatch) => swatch.getAttribute("aria-label"));
}

describe("colour picker", () => {
  test("on unstyled text it opens on Automatic, under its title", async () => {
    const { menu } = await openPicker("");
    expect(menu.textContent).toContain("Text colour");
    expect(selectedSwatch(menu)).toEqual(["Automatic"]);
  });

  test("closing it without a choice writes nothing", async () => {
    const { menu, onChange } = await openPicker("");
    await act(async () => {
      menu.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("marks the preset the text already uses", async () => {
    const [, preset] = TEXT_COLOUR_PRESETS;
    if (!preset) throw new Error("no presets");
    const { menu } = await openPicker(preset.value);
    expect(selectedSwatch(menu)).toEqual([preset.label]);
  });

  test("choosing Automatic removes the colour instead of writing one", async () => {
    const [, preset] = TEXT_COLOUR_PRESETS;
    if (!preset) throw new Error("no presets");
    const { menu, onChange } = await openPicker(preset.value);
    const automatic = menu.querySelector<HTMLElement>(
      '[role="radio"][aria-label="Automatic"]',
    );
    await act(async () => automatic?.click());
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("");
  });
});
