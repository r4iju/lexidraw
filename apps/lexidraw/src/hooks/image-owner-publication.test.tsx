import { expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { installDom, render } from "~/test/dom";
import { fixtureImage } from "~/test/image-fixture";
import { ImageFlow, type ImageState } from "~/lib/images/flow";

installDom();
function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const cleanupEntered = signal();
const cleanupRelease = signal();
const endCalled = signal();
const registered = signal();
const registrations = new Set<{
  end: () => Promise<void>;
  generation?: number;
}>();
let stored: string | null = null;
let saveCalls = 0;
let writeGate:
  | { entered: ReturnType<typeof signal>; release: ReturnType<typeof signal> }
  | undefined;
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "publication-alice" } },
  }),
}));
// Deferred device storage/cleanup is the host boundary. Browser account ownership,
// its cleanup queue, the mounted provider, and ImageFlow remain production code.
mock.module("~/lib/narration/device-store", () => ({
  browserNarrationStore: {
    load: async () => stored,
    save: async (
      _scope: string,
      _data: string,
      _expected: string | null,
      allowed: () => boolean,
    ) => {
      saveCalls++;
      if (!writeGate) throw new Error("Synthetic checkpoint disk failure");
      writeGate.entered.resolve();
      await writeGate.release.promise;
      expect(allowed()).toBe(false);
      return false;
    },
    clear: async () => {
      throw new Error("No document ACK in this test");
    },
  },
  registerNarration: (
    _account: string,
    end: () => Promise<void>,
    generation?: number,
  ) => {
    const registration = { end, generation };
    registrations.add(registration);
    registered.resolve();
    return () => registrations.delete(registration);
  },
  captureNarrationAccountCleanup: (_account: string, generation: number) => {
    const retiring = [...registrations].filter(
      (r) => r.generation === generation,
    );
    for (const registration of retiring) registrations.delete(registration);
    return async () => {
      cleanupEntered.resolve();
      // Earlier deferred host cleanup keeps the captured owner-end work queued.
      await cleanupRelease.promise;
      for (const registration of retiring) {
        endCalled.resolve();
        await registration.end();
      }
    };
  },
}));
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      pro: { status: { invalidate: async () => {} } },
      entities: { invalidate: async () => {} },
    }),
    auth: {
      getPowerPreference: {
        useQuery: () => ({
          data: { mode: "local" },
          error: null,
          isPending: false,
          refetch: async () => {},
        }),
      },
    },
    imagePower: {
      capability: {
        useQuery: () => ({
          data: { available: false },
          error: null,
          isPending: false,
          refetch: async () => {},
        }),
      },
      ...Object.fromEntries(
        ["generate", "save", "cancel"].map((name) => [
          name,
          {
            useMutation: () => ({
              mutateAsync: async () => {
                throw new Error("No synthetic server dispatch expected");
              },
            }),
          },
        ]),
      ),
    },
  },
}));
const {
  commitBrowserByok,
  browserByokAccount,
  browserByokSessionGeneration,
  browserByokStorageReady,
} = await import("~/lib/byok/browser-session");
const browserSession = await import("~/lib/byok/browser-session");
// Hold the renderer's owner snapshot during the queued-cleanup interval. All
// account/generation mutations and the provider's owner assertions stay real.
mock.module("~/lib/byok/browser-session", () => ({
  ...browserSession,
  useBrowserByok: () => browserSession.browserByok(),
}));
const { ImageGenerationProvider } = await import("./use-image-generation");

test("retired production account cannot publish memory-only image retry before queued cleanup ends its flow", async () => {
  let transportCalls = 0;
  const cachedImage = fixtureImage();
  window.fetch = Object.assign(
    async () => {
      transportCalls++;
      return Response.json({
        data: [
          { b64_json: cachedImage.base64, media_type: cachedImage.mimeType },
        ],
      });
    },
    { preconnect: () => {} },
  );
  commitBrowserByok("publication-alice");
  const generation = browserByokSessionGeneration();
  const retained = JSON.stringify({
    version: 1,
    owner: JSON.stringify([
      "publication-alice",
      "doc",
      "images-v1",
      window.location.origin,
    ]),
    fingerprints: [],
    image: cachedImage,
    uploadId: "00000000-0000-4000-8000-000000000012",
    prompt: "Retained tree",
    url: "https://app.test/api/generated-images/00000000-0000-4000-8000-000000000013",
  });
  stored = retained;
  const configured = signal();
  let mountedFlow: ImageFlow | undefined;
  const configure = ImageFlow.prototype.configure;
  const observation = spyOn(
    ImageFlow.prototype,
    "configure",
  ).mockImplementation(function (this: ImageFlow, ports) {
    configure.call(this, ports);
    mountedFlow = this;
    configured.resolve();
  });
  const view = await render(
    <ImageGenerationProvider entityId="doc" signedIn>
      <p>Editor</p>
    </ImageGenerationProvider>,
  );
  let unsubscribe = () => {};
  try {
    await configured.promise;
    await registered.promise;
    if (!mountedFlow)
      throw new Error("Mounted production flow was not configured");
    const flow = mountedFlow;
    await act(async () => {
      await flow.restore();
      await flow.retryCheckpoint();
    });
    const memoryOnly = flow.state();
    expect(memoryOnly.kind).toBe("saved");
    expect("durability" in memoryOnly && memoryOnly.durability).toBe(
      "memory_only",
    );
    expect(stored).toBe(retained);
    const publications: ImageState[] = [];
    unsubscribe = flow.subscribe(() => {
      const state = flow.state();
      if ("durability" in state && state.durability === "memory_only")
        publications.push(state);
    });
    let ended = false;
    void endCalled.promise.then(() => {
      ended = true;
    });
    writeGate = { entered: signal(), release: signal() };
    await act(async () => {
      const retry = flow.retryCheckpoint();
      await writeGate?.entered.promise;
      commitBrowserByok("publication-bob");
      await cleanupEntered.promise;
      expect(browserByokAccount()).toBe("publication-bob");
      expect(browserByokSessionGeneration()).toBeGreaterThan(generation);
      expect(ended).toBe(false);
      writeGate?.release.resolve();
      await retry;
      // Also retry after retirement: the initial production owner check rejects.
      const writes = saveCalls;
      await flow.retryCheckpoint();
      expect(saveCalls).toBe(writes);
      expect(ended).toBe(false);
      expect(publications).toEqual([]);
      expect(flow.state()).toBe(memoryOnly);
      expect(stored).toBe(retained);
      expect(transportCalls).toBe(0);
    });
  } finally {
    unsubscribe();
    await act(async () => {
      cleanupRelease.resolve();
      await browserByokStorageReady("publication-alice");
      await endCalled.promise;
    });
    await view.unmount();
    observation.mockRestore();
  }
});
