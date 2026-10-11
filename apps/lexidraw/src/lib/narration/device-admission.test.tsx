import { expect, mock, test } from "bun:test";
import { button, click, installDom, render } from "~/test/dom";
installDom();
import { createByokSession } from "../byok/session";
let calls = 0,
  stored: string | null = null,
  release = () => {};
const byok = createByokSession(
  async () => {
    calls++;
    return new Response(new Uint8Array(48000), {
      headers: { "Content-Type": "audio/pcm" },
    });
  },
  "https://app.test",
  { narrationFixture: true },
);
byok.replace("openrouter", "synthetic-source-read-narration-key");
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "alice" } },
  }),
}));
mock.module("../byok/browser-session", () => ({
  useBrowserByok: () => byok,
  browserByokAccount: () => "alice",
  browserByokSessionGeneration: () => 1,
  browserByokStorageReady: async () => {},
}));
mock.module("./device-store", () => ({
  registerNarration: () => () => {},
  browserNarrationStore: {
    load: async () => stored,
    save: async (_: string, data: string, expected: string | null) => {
      if (stored !== expected) return false;
      stored = data;
      return true;
    },
    clear: async () => {
      stored = null;
    },
  },
}));
const source = mock(async () => {
  await new Promise<void>((r) => {
    release = r;
  });
  return "Late original document";
});
const utils = {
  deviceNarration: {
    source: { fetch: source },
    saved: { invalidate: async () => {} },
  },
};
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => utils,
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
        useMutation: () => ({ mutateAsync: async () => ({ id: "saved" }) }),
      },
    },
  },
}));
const { DeviceNarrationPanel } = await import("./device-panel");
test("unmount during original document read cannot admit late narration", async () => {
  const view = await render(<DeviceNarrationPanel documentId="doc" />);
  await click(button("Generate on this device"));
  expect(source).toHaveBeenCalledTimes(1);
  await view.unmount();
  release();
  await new Promise((r) => setTimeout(r, 150));
  expect(calls).toBe(0);
  expect(stored).toBeNull();
});
