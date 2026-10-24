import { expect, mock, test } from "bun:test";
import { act } from "react";
import { button, click, installDom, render } from "~/test/dom";
import { createByokSession } from "../byok/session";
installDom();
import type { AudioPlayerProps } from "~/components/ui/audio-player";
mock.module("~/components/ui/audio-player", () => ({
  AudioPlayer: (props: AudioPlayerProps) => (
    <audio src={props.src} controls>
      <track kind="captions" />
    </audio>
  ),
}));
let generation = 1;
let account: string | undefined = "alice";
let ready: Promise<void> = Promise.resolve();
let stored: string | null = null;
let providerCalls = 0;
const byok = createByokSession(
  async () => {
    providerCalls++;
    return new Response(new Uint8Array(48000), {
      headers: { "Content-Type": "audio/pcm" },
    });
  },
  "https://app.test",
  { narrationFixture: true },
);
byok.replace("openrouter", "synthetic-narration-session-key");
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "alice" } },
  }),
}));
mock.module("../byok/browser-session", () => ({
  useBrowserByok: () => byok,
  browserByokAccount: () => account,
  browserByokSessionGeneration: () => generation,
  browserByokStorageReady: () => ready,
}));
const registered = new Set<() => Promise<void>>();
mock.module("./device-store", () => ({
  registerNarration: (_: string, end: () => Promise<void>) => {
    registered.add(end);
    return () => {
      registered.delete(end);
    };
  },
  browserNarrationStore: {
    load: async () => stored,
    save: async (_: string, data: string, expected: string | null) => {
      if (stored !== expected) return false;
      stored = data;
      return true;
    },
    clear: async (_: string, expected?: string | null) => {
      if (expected === undefined || expected === stored) stored = null;
    },
  },
}));
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      deviceNarration: {
        source: { fetch: async () => "New document narration" },
        saved: { invalidate: async () => {} },
      },
    }),
    deviceNarration: {
      capability: {
        useQuery: () => ({
          data: { available: true },
          error: null,
          isPending: false,
          refetch: async () => {},
        }),
      },
      saved: {
        useQuery: () => ({
          data: null,
          error: null,
          isPending: false,
          isLoading: false,
        }),
      },
      save: {
        useMutation: () => ({ mutateAsync: async () => ({ id: "receipt" }) }),
      },
    },
  },
}));
const { DeviceNarrationPanel } = await import("./device-panel");
test("mounted same-account narration waits for old session cleanup before registration restore and admission", async () => {
  let release = () => {};
  ready = new Promise<void>((r) => {
    release = r;
  });
  generation = 2;
  const view = await render(<DeviceNarrationPanel documentId="doc" />);
  await click(button("Narrate on this device"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(registered.size).toBe(0);
  expect(providerCalls).toBe(0);
  expect(stored).toBeNull();
  release();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(providerCalls).toBe(1);
  expect(stored).toContain('"status":"completed"');
  const newer = stored;
  await view.unmount();
  // An old generation is not allowed to erase the replacement checkpoint.
  generation = 3;
  stored = newer;
  account = "alice";
});

test("unmount while session storage is preparing cancels the queued narration admission", async () => {
  stored = null;
  providerCalls = 0;
  generation = 3;
  let release = () => {};
  ready = new Promise<void>((r) => {
    release = r;
  });
  const view = await render(<DeviceNarrationPanel documentId="doc" />);
  await click(button("Narrate on this device"));
  await view.unmount();
  release();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  expect(providerCalls).toBe(0);
  expect(stored).toBeNull();
});
