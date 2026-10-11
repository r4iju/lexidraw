import { expect, mock, test } from "bun:test";
import { act, useState } from "react";
import { installDom, render, button, click, type } from "~/test/dom";
import { createByokSession } from "~/lib/byok/session";
import {
  createTestDatabase,
  installServerRuntime,
} from "~/test/server-runtime";
import * as schema from "@packages/drizzle/drizzle-schema";

import { GeneratedImages } from "~/server/entities/generated-images";
import { PublicAccess } from "@packages/types";
import { fixtureImage } from "~/test/image-fixture";
installDom();
await installServerRuntime();
const db = await createTestDatabase();
const { findEntityWith, findReadableFacts } = await import(
  "~/server/entities/readable"
);
const { createImagePowerRouter } = await import(
  "~/server/api/routers/image-power"
);
const { entityRouter } = await import("~/server/api/routers/entities");
// Synthetic authenticated request context omits host-only request fields.
const context = {
  drizzle: db,
  schema,
  session: { user: { id: "d4-alice" }, expires: "2099-01-01" },
  auth: { kind: "session" },
  headers: new Headers(),
} as never;
const objects = new Map<string, Uint8Array>();
const privateImages = new GeneratedImages(db.$client, {
  now: () => 1000,
  canEdit: async (a, e) => !!(await findEntityWith(db, e, a, "edit")),
  canRead: async (a, e) => !!(await findReadableFacts(db, e, a)),
  store: {
    put: async (p, b) => {
      puts++;
      objects.set(p, b);
      return `https://private.test/${p}`;
    },
    remove: async (p) => {
      objects.delete(p);
    },
    read: async (p) => objects.get(p) ?? null,
  },
});
const imageCaller = createImagePowerRouter({
  images: () => privateImages,
  source: async () => "local",
}).createCaller(context);
const entityCaller = entityRouter.createCaller(context);
let receiptMode: "valid" | "empty" | "wrong_entity" | "stale" = "valid";
let failMetadata = false;
let useRealStorage = false;

let stored: string | null = null;
let providerCalls = 0;
let uploads = 0;
let snapshots = 0;
let puts = 0;
let metadata = 0;
const errors: string[] = [];
const byok = createByokSession(async () => {
  throw Error("No BYOK dispatch");
}, "https://app.test");
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: "d4-alice" } },
  }),
}));
mock.module("~/lib/byok/browser-session", () => ({
  useBrowserByok: () => byok,
  browserByokAccount: () => "d4-alice",
  browserByokSessionGeneration: () => 1,
  browserByokStorageReady: async () => {},
}));
mock.module("~/lib/narration/device-store", () => ({
  registerNarration: () => () => {},
  browserNarrationStore: {
    load: async () => stored,
    save: async (_: string, value: string, expected: string | null) => {
      if (stored !== expected) return false;
      stored = value;
      return true;
    },
    clear: async (_: string, expected: string) => {
      if (stored !== expected) return false;
      stored = null;
      return true;
    },
  },
}));
mock.module("sonner", () => ({
  toast: {
    error: (s: string) => errors.push(s),
    success: () => {},
    info: () => {},
  },
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
mock.module("next/image", () => ({
  default: (props: { src: string; alt: string }) => (
    <img src={props.src} alt={props.alt} />
  ),
}));
mock.module("./../server-actions", () => ({
  revalidateDashboard: async () => {},
}));
mock.module("~/hooks/use-image-insertion", () => ({
  useUnsplashImage: () => ({ searchImage: async () => null, isLoading: false }),
}));
mock.module("@vercel/blob/client", () => ({
  put: async () => {
    puts++;
    throw Error("No public put");
  },
}));
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      pro: { status: { invalidate: async () => {} } },
      entities: {
        invalidate: async () => {},
        generatedThumbnail: {
          fetch: async (input: never) => entityCaller.generatedThumbnail(input),
        },
      },
    }),
    auth: {
      getPowerPreference: {
        useQuery: () => ({ data: { mode: "pro" }, isPending: false }),
      },
    },
    snapshot: {
      generateClientUploadTokens: {
        useMutation: () => ({
          mutate: () => {
            snapshots++;
            throw Error("No snapshot token");
          },
        }),
      },
    },
    entities: {
      commitGeneratedThumbnail: {
        useMutation: () => ({
          mutateAsync: async (input: never) => {
            metadata++;
            if (failMetadata) throw Error("Synthetic metadata outage");
            const receipt = await entityCaller.commitGeneratedThumbnail(input);
            if (receiptMode === "empty") return {};
            if (receiptMode === "wrong_entity")
              return { ...receipt, entityId: "other" };
            if (receiptMode === "stale") {
              await entityCaller.update({
                id: entity.id,
                screenShotLight: entity.screenShotLight,
                screenShotDark: entity.screenShotLight,
              });
            }
            return receipt;
          },
        }),
      },
      update: {
        useMutation: () => ({
          mutate: () => {
            metadata++;
            throw Error("No generic metadata");
          },
        }),
      },
    },
    imagePower: {
      capability: {
        useQuery: () => ({
          data: { available: true, maximum: 1, fixture: true },
          isPending: false,
        }),
      },
      generate: {
        useMutation: () => ({
          mutateAsync: async () => {
            providerCalls++;
            return fixtureImage();
          },
        }),
      },
      cancel: {
        useMutation: () => ({
          mutateAsync: async () => {
            throw Error("No paid cancel");
          },
        }),
      },
      save: {
        useMutation: () => ({
          mutateAsync: async (input: never) => {
            uploads++;
            if (useRealStorage) return imageCaller.save(input);
            return {
              id: "00000000-0000-4000-8000-000000000041",
              url: "/api/generated-images/00000000-0000-4000-8000-000000000041",
            };
          },
        }),
      },
    },
  },
}));
const { ImageGenerationProvider, useImageGeneration } = await import(
  "~/hooks/use-image-generation"
);
const { default: ThumbnailModal } = await import("./icon-modal");
// The mounted modal reads only these fields from the list-row fixture.
const entity = {
  id: "d4-doc",
  title: "Original",
  screenShotLight: "https://app.test/original.png",
} as Parameters<typeof ThumbnailModal>[0]["entity"];
let action: ReturnType<typeof useImageGeneration>;
function Probe() {
  action = useImageGeneration();
  return null;
}
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <ImageGenerationProvider entityId={entity.id} signedIn>
      <Probe />
      <ThumbnailModal entity={entity} isOpen={open} onOpenChange={setOpen} />
    </ImageGenerationProvider>
  );
}
async function start() {
  await act(async () => {
    button("Generate")?.dispatchEvent(
      new window.MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
  });
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="Generate a thumbnail"]',
  );
  if (!input) throw Error("Generate input unavailable");
  await type(input, "Tree");
  await act(async () => {
    input
      .closest("form")
      ?.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}
test("generated preview then Cancel writes no artifact or thumbnail and keeps the paid result recoverable", async () => {
  stored = null;
  errors.length = 0;
  providerCalls = uploads = snapshots = puts = metadata = 0;
  const view = await render(<Harness />);
  await start();
  await click(button("Accept maximum and generate"));
  expect(providerCalls).toBe(1);
  expect(
    document.querySelector('img[alt="Thumbnail"]')?.getAttribute("src"),
  ).toStartWith("blob:");
  await click(button("Cancel"));
  expect([uploads, snapshots, puts, metadata]).toEqual([0, 0, 0, 0]);
  expect(entity.screenShotLight).toBe("https://app.test/original.png");
  expect(String(stored)).toContain('"image"');
  expect(errors).toEqual([]);
  await view.unmount();
});

// This path crosses authenticated artifact and entity procedures; only storage and supplier delivery are injected.
test("explicit generated Save keeps private upload on metadata failure and retries without generation or reupload", async () => {
  stored = null;
  errors.length = 0;
  providerCalls = uploads = snapshots = puts = metadata = 0;
  await db
    .insert(schema.users)
    .values({ id: "d4-alice", name: "Alice", email: "d4-alice@example.test" });
  await db.insert(schema.entities).values({
    id: entity.id,
    title: entity.title,
    userId: "d4-alice",
    entityType: "directory",
    elements: "{}",
    screenShotLight: entity.screenShotLight,
    screenShotDark: entity.screenShotLight,
    publicAccess: PublicAccess.PRIVATE,
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
  });
  useRealStorage = true;
  failMetadata = true;
  const view = await render(<Harness />);
  await start();
  await click(button("Accept maximum and generate"));
  await click(button("Save thumbnail"));
  expect(uploads).toBe(1);
  expect(puts).toBe(1);
  expect(metadata).toBe(1);
  expect(String(stored)).toContain('"url"');
  failMetadata = false;
  await click(button("Save thumbnail"));
  expect([providerCalls, uploads, puts, snapshots, metadata]).toEqual([
    1, 1, 1, 0, 2,
  ]);
  expect(stored).toBeNull();
  const saved = await entityCaller.generatedThumbnail({ entityId: entity.id });
  expect(saved.light).toMatch(/^\/api\/generated-images\//);
  expect(saved.dark).toBe(saved.light);
  const bytes = await privateImages.read(
    "d4-alice",
    saved.light.split("/").at(-1) ?? "",
  );
  expect(bytes?.length).toBeGreaterThan(0);
  expect(
    await privateImages.read("", saved.light.split("/").at(-1) ?? ""),
  ).toBeNull();
  await view.unmount();
});

test("deliberate quote decline retains the draft, while ending the owner is a failed outcome rather than a decline", async () => {
  stored = null;
  errors.length = 0;
  providerCalls = uploads = snapshots = puts = metadata = 0;
  const view = await render(<Harness />);
  await start();
  await click(button("Decline"));
  expect(
    document.querySelector('img[alt="Thumbnail"]')?.getAttribute("src"),
  ).toBe(entity.screenShotLight);
  expect(errors).toEqual([]);
  expect([providerCalls, uploads, snapshots, puts, metadata]).toEqual([
    0, 0, 0, 0, 0,
  ]);
  let pending: Promise<unknown> | undefined;
  await act(async () => {
    pending = action.generateImageData("Another tree");
    await new Promise((r) => setTimeout(r, 10));
  });
  await view.unmount();
  expect(await pending).toMatchObject({ kind: "failed" });
});

test("empty, wrong-entity and superseded thumbnail receipts retain the exact private image until fresh readback", async () => {
  stored = null;
  errors.length = 0;
  providerCalls = uploads = snapshots = puts = metadata = 0;
  useRealStorage = true;
  failMetadata = false;
  const view = await render(<Harness />);
  await start();
  await click(button("Accept maximum and generate"));
  for (const mode of ["empty", "wrong_entity", "stale"] as const) {
    receiptMode = mode;
    await click(button("Save thumbnail"));
    expect(stored).not.toBeNull();
    expect(String(stored)).toContain('"url"');
  }
  receiptMode = "valid";
  await click(button("Save thumbnail"));
  expect(stored).toBeNull();
  expect([providerCalls, uploads, puts, snapshots, metadata]).toEqual([
    1, 1, 1, 0, 4,
  ]);
  await view.unmount();
});
