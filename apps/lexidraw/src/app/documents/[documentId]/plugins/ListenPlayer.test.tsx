/// <reference types="bun" />
import { installDom, render } from "~/test/dom";

installDom("https://app.test/documents/1");

import { afterEach, describe, expect, mock, test } from "bun:test";
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
type Part = import("~/lib/narration/listen-contracts").ListenSegment;
/**
 * The document's audio as the server answers it; none until a test sets it,
 * so the player opens on "No audio segments found".
 */
type QueryError = (Error & { data?: { code: string } }) | null;
type ServerFixture = {
  status: string | undefined;
  segments: Part[] | undefined;
  version: number;
  statusError: QueryError;
  manifestError: QueryError;
  statusPending: boolean;
  manifestPending: boolean;
  listeners: Set<() => void>;
  set: (next: {
    status?: string;
    segments?: Part[];
    statusError?: QueryError;
    manifestError?: QueryError;
    statusPending?: boolean;
    manifestPending?: boolean;
  }) => void;
};
const server: ServerFixture = {
  status: undefined,
  segments: undefined,
  version: 0,
  statusError: null,
  manifestError: null,
  statusPending: false,
  manifestPending: false,
  listeners: new Set<() => void>(),
  set(next: {
    status?: string;
    segments?: Part[];
    statusError?: (Error & { data?: { code: string } }) | null;
    manifestError?: (Error & { data?: { code: string } }) | null;
    statusPending?: boolean;
    manifestPending?: boolean;
  }): void {
    Object.assign(server, next);
    server.version++;
    for (const listener of server.listeners) listener();
  },
};
const retryStatus = mock(async () => {}),
  retryManifest = mock(async () => {});
const subscribe = (listener: () => void) => {
  server.listeners.add(listener);
  return () => server.listeners.delete(listener);
};
const { useSyncExternalStore } = await import("react");
// The player's own settings, and the session behind them, are not under test.
mock.module("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ config: { getAudioConfig: { invalidate() {} } } }),
    config: {
      getAudioConfig: { useQuery: () => ({ data: undefined }) },
      updateAudioConfig: { useMutation: () => ({ mutate() {} }) },
    },
    narration: {
      capability: {
        useQuery: () => ({
          data: { available: false, fixture: false, reason: "Unavailable" },
          isPending: false,
        }),
      },
      latest: { useQuery: () => ({ data: null, isPending: false }) },
      quote: { useQuery: () => ({ isPending: true }) },
      operation: { useQuery: () => ({ isPending: true }) },
      saved: { useQuery: () => ({ isPending: true }) },
      generate: { useMutation: () => ({ mutate() {} }) },
      cancel: { useMutation: () => ({ mutate() {} }) },
    },
    tts: {
      startDocumentTts: {
        useMutation: () => ({ mutateAsync: async () => ({}) }),
      },
      getDocumentTtsStatus: {
        useQuery: () => {
          useSyncExternalStore(subscribe, () => server.version);
          const status = server.status;
          return {
            data: status ? { status } : undefined,
            error: server.statusError,
            isPending: server.statusPending,
            isLoading: server.statusPending,
            refetch: retryStatus,
          };
        },
      },
      getDocumentTtsManifest: {
        useQuery: () => {
          useSyncExternalStore(subscribe, () => server.version);
          const segments = server.segments;
          return {
            data: segments ? { segments } : undefined,
            refetch: retryManifest,
            error: server.manifestError,
            isPending: server.manifestPending,
            isLoading: server.manifestPending,
          };
        },
      },
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
const { TooltipProvider } = await import("~/components/ui/tooltip");
const { ListenPlayer } = await import("./ListenPlayer");

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  retryStatus.mockClear();
  retryManifest.mockClear();
  unmount = undefined;
  server.set({
    status: undefined,
    segments: undefined,
    statusError: null,
    manifestError: null,
    statusPending: false,
    manifestPending: false,
  });
});

/** The player, opened by a button beside it or an item in a menu. */
function Page() {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
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
    </TooltipProvider>
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

  const part = (index: number) => ({
    index,
    text: `Part ${index}.`,
    audioUrl: `https://blob.test/tts/chunks/${index}.mp3`,
  });
  const playing = () => document.querySelector("audio")?.getAttribute("src");
  async function end() {
    await act(async () => {
      document.querySelector("audio")?.dispatchEvent(new Event("ended"));
    });
    await settle();
  }

  test("while the audio is made, plays the first part and follows on to each as it comes", async () => {
    server.set({ status: "processing", segments: [part(0)] });
    ({ unmount } = await render(<Page />));
    await openFromButton();
    expect(playing()).toBe(part(0).audioUrl);

    await act(async () => server.set({ segments: [part(0), part(1)] }));
    await settle();
    expect(playing()).toBe(part(0).audioUrl);
    await end();
    expect(playing()).toBe(part(1).audioUrl);

    await end();
    expect(document.body.textContent).toContain("Making the next part…");
    await act(async () =>
      server.set({ status: "ready", segments: [part(0), part(1), part(2)] }),
    );
    await settle();
    expect(playing()).toBe(part(2).audioUrl);
    expect(document.body.textContent).not.toContain("Making the next part…");
  });
});

test("authoritative same-length replacement and shorter manifest replace old audio", async () => {
  const first = {
      index: 0,
      text: "Old",
      audioUrl: "https://blob.test/old/0.mp3",
    },
    second = {
      index: 1,
      text: "Old second",
      audioUrl: "https://blob.test/old/1.mp3",
    };
  server.set({ status: "ready", segments: [first, second] });
  ({ unmount } = await render(<Page />));
  await openFromButton();
  const replacement = {
    index: 0,
    text: "New",
    audioUrl: "https://blob.test/new/0.mp3",
  };
  await act(async () =>
    server.set({
      segments: [
        replacement,
        { ...second, audioUrl: "https://blob.test/new/1.mp3" },
      ],
    }),
  );
  await settle();
  expect(document.querySelector("audio")?.getAttribute("src")).toBe(
    replacement.audioUrl,
  );
  await act(async () => server.set({ segments: [] }));
  await settle();
  expect(document.querySelector("audio")).toBeNull();
});

test("status and manifest failures are truthful, retain authorized stale playback, and retry only their read", async () => {
  server.set({ statusError: new Error("status offline") });
  ({ unmount } = await render(<Page />));
  await openFromButton();
  expect(document.body.textContent).toContain(
    "Audio status could not be refreshed",
  );
  expect(document.body.textContent).not.toContain("No audio segments found");
  await act(async () => control("Retry audio status")?.click());
  expect(retryStatus).toHaveBeenCalledTimes(1);
  expect(retryManifest).toHaveBeenCalledTimes(0);
  await act(async () =>
    server.set({ status: "ready", statusError: null, manifestPending: true }),
  );
  await settle();
  expect(document.body.textContent).toContain("Loading audio");
  expect(document.body.textContent).not.toContain("No audio segments found");
  await act(async () =>
    server.set({
      manifestPending: false,
      manifestError: new Error("manifest offline"),
    }),
  );
  await settle();
  expect(document.body.textContent).toContain(
    "Audio segments could not be refreshed",
  );
  expect(document.body.textContent).not.toContain("No audio segments found");
  const segment = {
    index: 0,
    text: "Retained",
    audioUrl: "https://blob.test/retained/0.mp3",
  };
  await act(async () => server.set({ segments: [segment] }));
  await settle();
  expect(document.querySelector("audio")?.getAttribute("src")).toBe(
    segment.audioUrl,
  );
  expect(document.body.textContent).toContain("Cached audio may be stale");
  const reads = retryManifest.mock.calls.length;
  await act(async () => control("Retry audio segments")?.click());
  expect(retryManifest.mock.calls.length).toBe(reads + 1);
  await act(async () =>
    server.set({
      manifestError: Object.assign(new Error("forbidden"), {
        data: { code: "FORBIDDEN" },
      }),
    }),
  );
  await settle();
  expect(document.querySelector("audio")).toBeNull();
  expect(document.body.textContent).toContain(
    "Audio access could not be confirmed",
  );
});

test("malformed manifest cannot become playable media", async () => {
  server.set({
    status: "ready",
    segments: [{ index: 0, text: "Malformed", audioUrl: "" }],
  });
  ({ unmount } = await render(<Page />));
  await openFromButton();
  expect(document.querySelector("audio")).toBeNull();
  expect(document.body.textContent).toContain(
    "Audio segments could not be read safely",
  );
});
