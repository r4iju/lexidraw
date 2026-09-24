/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import {
  button,
  click,
  installDom,
  openWithKeyboard,
  render,
} from "~/test/dom";

installDom();
mock.module("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
const { NewMenu } = await import("./new-menu");

const items = () => [...document.querySelectorAll('[role="menuitem"]')];

describe("the New menu", () => {
  test("creates each kind of file through an action, not by following a link", async () => {
    const onCreate = mock((_kind: string) => {});
    const view = await render(<NewMenu onCreate={onCreate} />);
    await openWithKeyboard(button("New"));
    expect(
      items().map((item) => item.querySelector("[data-label]")?.textContent),
    ).toEqual(["Document", "Drawing", "Folder", "Link"]);
    expect(document.querySelector('[role="menu"] a')).toBeNull();
    await click(items()[1]);
    expect(onCreate).toHaveBeenCalledWith("drawing");
    await view.unmount();
  });

  test("shows it is busy while a file is being created", async () => {
    const view = await render(<NewMenu onCreate={() => {}} pending />);
    const trigger = button("New");
    expect(trigger?.getAttribute("aria-busy")).toBe("true");
    await view.unmount();
  });
});
