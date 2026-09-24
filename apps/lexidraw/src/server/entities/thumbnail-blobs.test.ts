/// <reference types="bun" />
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { default: env } = await import("@packages/env");

const HOST = new URL(env.VERCEL_BLOB_STORAGE_HOST).origin;
const uploadedPaths: string[] = [];
const deleted: string[] = [];
const refused: string[] = [];
const overwrites: unknown[] = [];
let deleteFailure: Error | undefined;

// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  put: async (pathname: string, _body: unknown, options: object) => {
    uploadedPaths.push(pathname);
    overwrites.push((options as { allowOverwrite?: unknown }).allowOverwrite);
    return { url: `${HOST}/${pathname}`, pathname };
  },
  del: async (urls: string | string[]) => {
    if (deleteFailure) {
      refused.push(...[urls].flat());
      throw deleteFailure;
    }
    deleted.push(...[urls].flat());
  },
}));
const realBlobClient = await import("@vercel/blob/client");
mock.module("@vercel/blob/client", () => ({
  ...realBlobClient,
  generateClientTokenFromReadWriteToken: async (options: {
    allowOverwrite?: unknown;
  }) => {
    overwrites.push(options.allowOverwrite);
    return "vercel_blob_client_test";
  },
}));

const { entityRouter } = await import("~/server/api/routers/entities");
const { snapshotRouter } = await import("~/server/api/routers/snapshot");
const { uploadBlobStep } = await import(
  "~/workflows/thumbnail/upload-blobs-step"
);

const OWNER = "thumbb_owner";
const EDITOR = "thumbb_editor";

function contextOf(userId: string) {
  return {
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never;
}

const owner = {
  entities: entityRouter.createCaller(contextOf(OWNER)),
  snapshot: snapshotRouter.createCaller(contextOf(OWNER)),
};

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "thumbb-owner@example.test" },
    { id: EDITOR, name: "Editor", email: "thumbb-editor@example.test" },
  ]);
  await db.insert(schema.entities).values(
    [
      "thumbb_icon",
      "thumbb_shared",
      "thumbb_copy",
      "thumbb_image",
      "thumbb_flaky",
    ].map((id) => ({
      id,
      title: id,
      elements: "{}",
      entityType: "drawing",
      userId: OWNER,
      publicAccess: PublicAccess.PRIVATE,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    })),
  );
});

beforeEach(() => {
  uploadedPaths.length = 0;
  deleted.length = 0;
  refused.length = 0;
  overwrites.length = 0;
  deleteFailure = undefined;
});

/** What the icon modal does: a token per theme, a client upload, the URLs. */
async function uploadIcon(entityId: string) {
  const tokens = await owner.snapshot.generateClientUploadTokens({
    entityId,
    contentType: "image/png",
  });
  const urlOf = (theme: "light" | "dark") =>
    `${HOST}/${tokens.find((token) => token.theme === theme)?.pathname}`;
  return { light: urlOf("light"), dark: urlOf("dark") };
}

async function saveIcon(
  entityId: string,
  icon: { light?: string; dark?: string },
) {
  await owner.entities.update({
    id: entityId,
    screenShotLight: icon.light,
    screenShotDark: icon.dark,
  });
}

async function shotsOf(entityId: string) {
  const [row] = await db
    .select({
      light: schema.entities.screenShotLight,
      dark: schema.entities.screenShotDark,
    })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId));
  return row;
}

describe("replacing a custom icon", () => {
  test("stores it at a new URL and deletes the one it replaced", async () => {
    const first = await uploadIcon("thumbb_icon");
    await saveIcon("thumbb_icon", first);
    const second = await uploadIcon("thumbb_icon");
    await saveIcon("thumbb_icon", second);

    expect(second.light).not.toBe(first.light);
    expect(second.dark).not.toBe(first.dark);
    expect(await shotsOf("thumbb_icon")).toEqual(second);
    expect(deleted.sort()).toEqual([first.dark, first.light].sort());
  });

  test("keeps a replaced picture another entity still shows", async () => {
    const first = await uploadIcon("thumbb_shared");
    await saveIcon("thumbb_shared", first);
    await db
      .update(schema.entities)
      .set({ screenShotLight: first.light })
      .where(eq(schema.entities.id, "thumbb_copy"));

    await saveIcon("thumbb_shared", await uploadIcon("thumbb_shared"));

    expect(deleted).toEqual([first.dark]);
  });

  test("keeps a replaced picture that was not uploaded as its thumbnail", async () => {
    const documentImage = `${HOST}/thumbb_image-0b8f5c1e.png`;
    const first = await uploadIcon("thumbb_image");
    await saveIcon("thumbb_image", { light: documentImage, dark: first.dark });

    await saveIcon("thumbb_image", await uploadIcon("thumbb_image"));

    expect(deleted).toEqual([first.dark]);
  });

  test("is saved even when the replaced picture cannot be deleted", async () => {
    const first = await uploadIcon("thumbb_flaky");
    await saveIcon("thumbb_flaky", first);
    const second = await uploadIcon("thumbb_flaky");
    deleteFailure = new realBlob.BlobServiceNotAvailable();

    await saveIcon("thumbb_flaky", second);

    expect(refused.sort()).toEqual([first.dark, first.light].sort());
    expect(await shotsOf("thumbb_flaky")).toEqual(second);
  });
});

describe("naming an uploaded thumbnail", () => {
  test("gives every upload its own path and lets none overwrite", async () => {
    const icons = [
      await uploadIcon("thumbb_icon"),
      await uploadIcon("thumbb_icon"),
    ].flatMap((icon) => [icon.light, icon.dark]);
    // A retried step uploads the same picture again.
    await uploadBlobStep("thumbb_icon", "light", new Uint8Array([1]), "webp");
    await uploadBlobStep("thumbb_icon", "light", new Uint8Array([1]), "webp");

    expect(new Set(icons).size).toBe(4);
    expect(new Set(uploadedPaths).size).toBe(2);
    expect(overwrites.filter(Boolean)).toEqual([]);
  });
});

describe("uploading a thumbnail", () => {
  test("is open to someone the entity is shared with for editing", async () => {
    await db.insert(schema.sharedEntities).values({
      id: "thumbb_share",
      entityId: "thumbb_shared",
      userId: EDITOR,
      accessLevel: AccessLevel.EDIT,
    });
    const tokens = await snapshotRouter
      .createCaller(contextOf(EDITOR))
      .generateClientUploadTokens({
        entityId: "thumbb_shared",
        contentType: "image/png",
      });
    expect(tokens).toHaveLength(2);
  });
});
