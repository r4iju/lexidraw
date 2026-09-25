/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { click, installDom, openWithKeyboard, render } from "~/test/dom";

installDom();
mock.module("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
const { EntityMenu } = await import("./entity-menu");

type Props = ComponentProps<typeof EntityMenu>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    title: "Launch plan",
    href: "/documents/d1",
    favorited: false,
    archived: false,
    onShare: () => {},
    onCopyLink: () => {},
    onRename: () => {},
    onTags: () => {},
    onThumbnail: () => {},
    onToggleFavorite: () => {},
    onToggleArchive: () => {},
    onDelete: () => {},
    ...overrides,
  };
}

/** The open menu, top to bottom, with "|" for each separator. */
function menu() {
  return [
    ...document.querySelectorAll('[role="menuitem"], [role="separator"]'),
  ].map((node) => (node.getAttribute("role") === "separator" ? "|" : node));
}

async function open(overrides: Partial<Props> = {}) {
  const view = await render(<EntityMenu {...props(overrides)} />);
  await openWithKeyboard(
    document.querySelector('[aria-label="More actions for Launch plan"]'),
  );
  return view;
}

describe("a file's ⋯ menu", () => {
  test("is grouped from opening and sharing to deleting, last", async () => {
    const view = await open();
    expect(
      menu().map((item) =>
        typeof item === "string" ? item : item.textContent?.trim(),
      ),
    ).toEqual([
      "Open in new tab",
      "Share…",
      "Copy link",
      "|",
      "Rename…",
      "Tags…",
      "Change thumbnail…",
      "Add to favorites",
      "|",
      "Archive",
      "|",
      "Delete…",
    ]);
    await view.unmount();
  });

  test("offers Share only to the file's owner", async () => {
    const view = await open({ onShare: undefined });
    const labels = menu().map((item) =>
      typeof item === "string" ? item : item.textContent?.trim(),
    );
    expect(labels.slice(0, 3)).toEqual(["Open in new tab", "Copy link", "|"]);
    expect(labels).not.toContain("Share…");
    await view.unmount();
  });

  test("gives every item an icon", async () => {
    const view = await open();
    for (const item of menu()) {
      if (typeof item === "string") continue;
      expect(item.querySelector("svg")).not.toBeNull();
    }
    await view.unmount();
  });

  test("opens the file in a new tab", async () => {
    const view = await open();
    const item = menu().find(
      (node) =>
        typeof node !== "string" && node.textContent === "Open in new tab",
    ) as Element;
    expect(item.getAttribute("href")).toBe("/documents/d1");
    expect(item.getAttribute("target")).toBe("_blank");
    await view.unmount();
  });

  test("offers to undo a favorite or an archive", async () => {
    const onToggleArchive = mock(() => {});
    const view = await open({
      favorited: true,
      archived: true,
      onToggleArchive,
    });
    const labels = menu().map((item) =>
      typeof item === "string" ? item : item.textContent?.trim(),
    );
    expect(labels).toContain("Remove from favorites");
    expect(labels).toContain("Unarchive");
    await click(
      menu().find(
        (node) => typeof node !== "string" && node.textContent === "Unarchive",
      ) as Element,
    );
    expect(onToggleArchive).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
