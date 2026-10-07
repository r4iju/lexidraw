/// <reference types="bun" />
import { installDom, openWithKeyboard, render } from "~/test/dom";

installDom();

import { expect, mock, test } from "bun:test";
import { createEditor } from "lexical";
import { createContext } from "react";
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
const { InsertMenu } = await import("./insert-item");

test("the Insert menu offers no slide deck, which documents no longer make", async () => {
  const { unmount } = await render(
    <UnsavedChangesProvider saveBeforeLeaving={async () => true}>
      <TooltipProvider>
        <InsertMenu editor={createEditor()} showModal={() => {}} />
      </TooltipProvider>
    </UnsavedChangesProvider>,
  );
  try {
    await openWithKeyboard(document.querySelector("button"));
    const items = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].map((item) => item.textContent?.trim());

    expect(items).toContain("Chart");
    expect(items.filter((item) => /slide/i.test(item ?? ""))).toEqual([]);
  } finally {
    await unmount();
  }
});
