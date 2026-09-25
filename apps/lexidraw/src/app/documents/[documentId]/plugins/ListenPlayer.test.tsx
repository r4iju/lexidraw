/// <reference types="bun" />
import { installDom, render } from "~/test/dom";

installDom("https://app.test/documents/1");

import { afterEach, describe, expect, mock, test } from "bun:test";
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
// No audio yet: the player opens on "No audio segments found".
mock.module("~/trpc/react", () => ({
  api: {
    tts: {
      startDocumentTts: {
        useMutation: () => ({ mutateAsync: async () => ({}) }),
      },
      getDocumentTtsStatus: { useQuery: () => ({ data: undefined }) },
      getDocumentTtsManifest: { useQuery: () => ({ data: undefined }) },
    },
  },
}));
mock.module("../utils/markdown", () => ({
  useMarkdownTools: () => ({ convertEditorStateToMarkdown: () => "" }),
}));

import { act, useState } from "react";
const { LexicalComposer } = await import("@lexical/react/LexicalComposer");
const {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} = await import("~/components/ui/dropdown-menu");
const { ListenPlayer } = await import("./ListenPlayer");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

/** The player, opened by a button beside it or an item in a menu. */
function Page() {
  const [open, setOpen] = useState(false);
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "listen",
        onError: (error) => {
          throw error;
        },
      }}
    >
      <button type="button" onClick={() => setOpen(!open)}>
        Play from cursor
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger>More</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            Play from cursor
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger>Tools</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Listen</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => setOpen(true)}>
                Play from cursor
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <div contentEditable suppressContentEditableWarning>
        Some text
      </div>
      <ListenPlayer
        documentId="1"
        open={open}
        onOpenChange={setOpen}
        anchor={null}
      />
    </LexicalComposer>
  );
}

const player = () =>
  [...document.querySelectorAll("h3")].find(
    (heading) => heading.textContent === "Listen",
  );
const control = (label: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 20)));

async function pressEscape(target: Element) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await settle();
}

async function openFromButton() {
  const opener = control("Play from cursor");
  if (!opener) throw new Error("no Play button");
  opener.focus();
  await act(async () => opener.click());
  await settle();
  return opener;
}

describe("the Listen player", () => {
  test("closes on Escape and hands focus back to the button that opened it", async () => {
    ({ unmount } = await render(<Page />));
    const opener = await openFromButton();
    expect(player()).toBeDefined();

    await pressEscape(document.activeElement ?? document.body);

    expect(player()).toBeUndefined();
    expect(document.activeElement).toBe(opener);
  });

  async function press(target: Element, key: string) {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
    await settle();
  }
  /** Picks Play from cursor from the menu `trigger` opens, down `path`. */
  async function openFromMenu(trigger: string, path: string[] = []) {
    const button = control(trigger);
    if (!button) throw new Error(`no ${trigger} button`);
    button.focus();
    await press(button, "Enter");
    for (const sub of path) {
      const subTrigger = control(sub);
      if (!subTrigger) throw new Error(`no ${sub} submenu`);
      subTrigger.focus();
      await press(subTrigger, "ArrowRight");
    }
    const menus = document.querySelectorAll("[role=menu]");
    const item = control(
      "Play from cursor",
      menus[menus.length - 1] ?? document,
    );
    if (!item) throw new Error("no menu item");
    item.focus();
    await act(async () => item.click());
    await settle();
    return button;
  }

  test.each([
    ["a menu", "More", []],
    ["a menu's submenu", "Tools", ["Listen"]],
  ])(
    "opened from %s, hands focus back to the menu's button",
    async (_, trigger, path) => {
      ({ unmount } = await render(<Page />));
      const button = await openFromMenu(trigger, path);
      expect(player()).toBeDefined();

      await pressEscape(document.activeElement ?? document.body);

      expect(player()).toBeUndefined();
      expect(document.activeElement).toBe(button);
    },
  );

  test("stays open on an Escape meant for the text being edited", async () => {
    ({ unmount } = await render(<Page />));
    await openFromButton();
    const text = document.querySelector<HTMLElement>("[contenteditable]");
    if (!text) throw new Error("no text");
    text.focus();

    await pressEscape(text);

    expect(player()).toBeDefined();
  });
});
