import { expect, mock, test } from "bun:test";
import { act } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ImageNode } from "@packages/lexical-nodes";
import { installDom, render, button, click } from "~/test/dom";
import { createByokSession } from "~/lib/byok/session";
import { fixtureImage } from "~/test/image-fixture";
import { OpenEntitySync } from "~/lib/open-entity-sync";
installDom();
let generationCalls = 0;
const byok = createByokSession(
  async () => {
    generationCalls++;
    return Response.json({
      data: [{ b64_json: fixtureImage().base64, media_type: "image/png" }],
    });
  },
  "https://app.test",
  { imageFixture: true },
);
let enabled = false;
let deferred: { entered: () => void; wait: Promise<void> } | undefined;
const upload = "00000000-0000-4000-8000-000000000012";
const receipt = "00000000-0000-4000-8000-000000000013";
const url = `https://app.test/api/generated-images/${receipt}`;
let stored: string | null = null;
let uploads: string[] = [];
let local = false;
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "alice" } },
  }),
}));
mock.module("~/lib/byok/browser-session", () => ({
  useBrowserByok: () => byok,
  browserByokAccount: () => "alice",
  browserByokSessionGeneration: () => 1,
  browserByokStorageReady: async () => {},
}));
mock.module("~/lib/narration/device-store", () => ({
  registerNarration: () => () => {},
  browserNarrationStore: {
    load: async () => stored,
    save: async (_: string, data: string, expected: string | null) => {
      if (deferred) {
        deferred.entered();
        await deferred.wait;
      }
      if (expected !== stored) return false;
      stored = data;
      return true;
    },
    clear: async (_: string, expected: string) => {
      if (stored !== expected) return false;
      stored = null;
      return true;
    },
  },
}));
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      pro: { status: { invalidate: async () => {} } },
      entities: { invalidate: async () => {} },
      imagePower: { current: { invalidate: async () => {} } },
    }),
    auth: {
      getPowerPreference: {
        useQuery: () => ({
          data: enabled
            ? { mode: "byok", provider: "openrouter" }
            : local
              ? { mode: "local" }
              : undefined,
          error: enabled || local ? null : Error("Query unavailable"),
          isPending: false,
          refetch: async () => {},
        }),
      },
    },
    entities: {
      commitGeneratedThumbnail: {
        useMutation: () => ({
          mutateAsync: async () => {
            throw Error("No thumbnail commit in this recovery fixture");
          },
        }),
      },
    },
    imagePower: {
      capability: {
        useQuery: () => ({
          data: { available: enabled, maximum: 1, fixture: true },
          error: null,
          isPending: false,
          refetch: async () => {},
        }),
      },
      generate: {
        useMutation: () => ({
          mutateAsync: async () => {
            throw Error("No Pro generation");
          },
        }),
      },
      cancel: {
        useMutation: () => ({
          mutateAsync: async () => {
            throw Error("No cancellation");
          },
        }),
      },
      save: {
        useMutation: () => ({
          mutateAsync: async (input: { idempotencyKey: string }) => {
            uploads.push(input.idempotencyKey);
            return { id: receipt, url };
          },
        }),
      },
    },
  },
}));
const {
  ImageGenerationProvider,
  LexicalImageGenerationProvider,
  useImageGeneration,
} = await import("./use-image-generation");
const empty = JSON.stringify({
  root: {
    type: "root",
    version: 1,
    children: [
      {
        type: "paragraph",
        version: 1,
        children: [],
        direction: null,
        format: "",
        indent: 0,
      },
    ],
    direction: null,
    format: "",
    indent: 0,
  },
});
for (const saved of [false, true])
  test(`restored ${saved ? "saved" : "completed"} image retries actual document save without capability or key`, async () => {
    local = saved;
    uploads = [];
    stored = JSON.stringify({
      version: 1,
      owner: JSON.stringify([
        "alice",
        "doc",
        "images-v1",
        window.location.origin,
      ]),
      fingerprints: [],
      image: fixtureImage(),
      uploadId: upload,
      prompt: "Retained tree",
      ...(saved ? { url } : {}),
    });
    let actual = empty;
    let dropped = true;
    let revision = new Date(1000);
    let releaseSave = () => {};
    const blockedSave = new Promise<void>((r) => {
      releaseSave = r;
    });
    let holdSave = true;
    const sync = new OpenEntitySync(
      { elements: actual, updatedAt: revision },
      {
        save: async (content) => {
          if (holdSave) {
            holdSave = false;
            await blockedSave;
          }
          actual = content.elements;
          revision = new Date(+revision + 1);
          return revision;
        },
        load: async () => ({ elements: actual, updatedAt: revision }),
        updatedAt: async () => revision,
      },
      () => {},
    );
    const view = await render(
      <ImageGenerationProvider entityId="doc" signedIn>
        <LexicalComposer
          initialConfig={{
            namespace: "recovery",
            nodes: [ImageNode],
            editorState: empty,
            onError: (e) => {
              throw e;
            },
          }}
        >
          <LexicalImageGenerationProvider
            persist={async (state) => {
              if (dropped) {
                dropped = false;
                const sending = sync.save(
                  { elements: empty },
                  { receipt: true },
                );
                const imageSave = sync.save(
                  { elements: JSON.stringify(state) },
                  { receipt: true },
                );
                const replacement = sync.save(
                  { elements: empty },
                  { receipt: true },
                );
                releaseSave();
                await sending;
                await replacement;
                return imageSave;
              }
              return sync.save(
                { elements: JSON.stringify(state) },
                { receipt: true },
              );
            }}
          >
            <p>Editor</p>
          </LexicalImageGenerationProvider>
        </LexicalComposer>
      </ImageGenerationProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(button("Insert retained image / retry document save")).toBeDefined();
    await click(button("Insert retained image / retry document save"));
    expect(stored).not.toBeNull();
    expect(actual).not.toContain(url);
    await click(button("Insert retained image / retry document save"));
    expect(actual.split(url)).toHaveLength(2);
    expect(stored).toBeNull();
    expect(uploads).toEqual(saved ? [] : [upload]);
    await view.unmount();
  });

let action: ReturnType<typeof useImageGeneration>;
function Probe() {
  action = useImageGeneration();
  return null;
}
test("production image provider unmount during pending write cannot dispatch paid generation", async () => {
  stored = null;
  enabled = true;
  generationCalls = 0;
  byok.replace("openrouter", "synthetic-image-pending-key");
  let release = () => {};
  let enter = () => {};
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  deferred = {
    entered: enter,
    wait: new Promise<void>((r) => {
      release = r;
    }),
  };
  const view = await render(
    <ImageGenerationProvider entityId="doc" signedIn>
      <Probe />
    </ImageGenerationProvider>,
  );
  const running = action.generateImageData("Tree");
  await entered;
  await view.unmount();
  release();
  await new Promise((r) => setTimeout(r, 80));
  expect(generationCalls).toBe(0);
  expect(String(stored)).toContain('"source":"byok"');
  deferred = undefined;
  enabled = false;
  void running;
});

test("key rotation while image admission is checkpointing settles the UI without dispatching either credential", async () => {
  stored = null;
  enabled = true;
  generationCalls = 0;
  byok.replace("openrouter", "synthetic-image-old-admission-key");
  let release = () => {};
  let enter = () => {};
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  deferred = {
    entered: enter,
    wait: new Promise<void>((r) => {
      release = r;
    }),
  };
  const view = await render(
    <ImageGenerationProvider entityId="doc" signedIn>
      <Probe />
    </ImageGenerationProvider>,
  );
  const running = action.generateImageData("Tree");
  await entered;
  byok.replace("openrouter", "synthetic-image-new-admission-key");
  await act(async () => {
    release();
    await new Promise((r) => setTimeout(r, 40));
  });
  expect(generationCalls).toBe(0);
  expect(action.isLoading).toBe(false);
  expect(document.body.textContent).toContain(
    "original image outcome is uncertain",
  );
  expect(await running).toMatchObject({ kind: "uncertain" });
  deferred = undefined;
  enabled = false;
  await view.unmount();
});
