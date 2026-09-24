/// <reference types="bun" />
import { installDom, openWithKeyboard, render } from "~/test/dom";

installDom();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { createEditor } from "lexical";
import { createContext, type ReactNode } from "react";
// Menus close when the route changes; there is no route here.
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
// Both reach tRPC and the validated env, which must not load in a window.
mock.module("~/hooks/use-auto-save", () => ({
  useAutoSave: () => ({ enabled: false }),
}));
mock.module("~/hooks/use-open-entity-sync", () => ({
  OpenEntityContext: createContext(null),
}));

const { TooltipProvider } = await import("~/components/ui/tooltip");
const { UnsavedChangesProvider } = await import("~/hooks/use-unsaved-changes");
const { DocumentSettingsProvider } = await import(
  "../../context/document-settings-context"
);
const { BlockFormatDropDown } = await import("./block-format");
const { ElementFormatDropdown } = await import("./element-format");
const { FontDropDown } = await import("./font");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

async function show(node: ReactNode) {
  ({ unmount } = await render(
    <UnsavedChangesProvider>
      <DocumentSettingsProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </DocumentSettingsProvider>
    </UnsavedChangesProvider>,
  ));
  const trigger = document.querySelector("button");
  await openWithKeyboard(trigger);
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  if (!menu) throw new Error("the menu did not open");
  return { trigger, menu };
}

function choices(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
}

/** What an item says, without the shortcut shown beside it. */
function name(item: Element) {
  const copy = item.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]'))
    hidden.remove();
  return copy.textContent?.trim();
}

function checked(menu: HTMLElement) {
  return choices(menu)
    .filter((item) => item.getAttribute("aria-checked") === "true")
    .map(name);
}

const noop = () => {};

describe("block type menu", () => {
  test("marks the current block type and offers heading 4", async () => {
    const { trigger, menu } = await show(
      <BlockFormatDropDown
        editor={createEditor()}
        blockType="h2"
        rootType="root"
      />,
    );
    expect(checked(menu)).toEqual(["Heading 2"]);
    expect(choices(menu).map(name)).toContain("Heading 4");
    // The trigger names the current type for a reader, whatever the width.
    expect(trigger?.textContent).toContain("Heading 2");
  });
});

describe("alignment menu", () => {
  test("offers left, centre, right and justify, marking the current one", async () => {
    const { menu } = await show(
      <ElementFormatDropdown
        editor={createEditor()}
        value="center"
        isRTL={false}
      />,
    );
    expect(choices(menu).map(name)).toEqual([
      "Left",
      "Center",
      "Right",
      "Justify",
    ]);
    expect(checked(menu)).toEqual(["Center"]);
  });
});

describe("font menu", () => {
  test("marks the current font and shows each name in its own face", async () => {
    const { menu } = await show(
      <FontDropDown editor={createEditor()} value="Georgia" showModal={noop} />,
    );
    expect(checked(menu)).toEqual(["Georgia"]);
    const georgia = choices(menu).find((item) => name(item) === "Georgia");
    expect(
      georgia?.querySelector<HTMLElement>("[style]")?.style.fontFamily,
    ).toContain("Georgia");
  });

  test("keeps the actions apart from the fonts, under a separator", async () => {
    const { menu } = await show(
      <FontDropDown editor={createEditor()} value="sans" showModal={noop} />,
    );
    const children = [...menu.children];
    const separator = children.findIndex(
      (child) => child.getAttribute("role") === "separator",
    );
    expect(separator).toBeGreaterThan(0);
    const before = children.slice(0, separator);
    const after = children.slice(separator + 1);
    expect(
      before.every(
        (child) =>
          child.querySelectorAll('[role="menuitem"]').length === 0 &&
          child.getAttribute("role") !== "menuitem",
      ),
    ).toBe(true);
    expect(after.map((child) => child.textContent).join(" ")).toContain(
      "Import a Google font",
    );
  });
});
