/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "etrash_owner";
const EDITOR = "etrash_editor";
const OTHER = "etrash_other";
const callerOf = (userId: string) =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const owner = callerOf(OWNER);

const at = new Date("2026-09-01T00:00:00.000Z");
const row = (
  id: string,
  entityType: string,
  deletedAt: Date | null,
  elements = "{}",
) => ({
  id,
  title: id,
  elements,
  entityType,
  userId: OWNER,
  publicAccess: PublicAccess.PRIVATE,
  createdAt: at,
  updatedAt: at,
  deletedAt,
});

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "etrash-owner@example.test" },
    { id: EDITOR, name: "Editor", email: "etrash-editor@example.test" },
    { id: OTHER, name: "Other", email: "etrash-other@example.test" },
  ]);
  await db
    .insert(schema.entities)
    .values([
      row("etrash_doc", "document", at),
      row(
        "etrash_url",
        "url",
        at,
        JSON.stringify({ url: "https://example.test" }),
      ),
      row("etrash_live", "document", null),
      row("etrash_folder", "directory", at),
    ]);
  await db.insert(schema.entities).values({
    ...row("etrash_kept", "document", null),
    parentId: "etrash_folder",
  });
  await db.insert(schema.sharedEntities).values({
    id: "etrash_share",
    entityId: "etrash_live",
    userId: EDITOR,
    accessLevel: AccessLevel.EDIT,
  });
  await db.insert(schema.uploadedVideos).values({
    id: "etrash_video",
    userId: OWNER,
    entityId: "etrash_doc",
    fileName: "etrash.mp4",
    signedUploadUrl: "",
    signedDownloadUrl: "https://example.test/etrash.mp4",
    requestId: "etrash_request",
    createdAt: at,
    updatedAt: at,
  });
});

const notFound = { code: "NOT_FOUND" };

describe("a file in the trash is not found, even by its owner", () => {
  test("for its thumbnail, uploads, media and link", async () => {
    await expect(
      owner.regenerateThumbnail({ id: "etrash_doc" }),
    ).rejects.toMatchObject(notFound);
    await expect(
      owner.generateUploadUrl({
        entityId: "etrash_doc",
        contentType: "image/png",
        mode: "direct",
      }),
    ).rejects.toMatchObject(notFound);
    await expect(
      owner.generateVideoUploadUrl({
        entityId: "etrash_doc",
        contentType: "video/mp4",
        mode: "direct",
      }),
    ).rejects.toMatchObject(notFound);
    await expect(owner.distillUrl({ id: "etrash_url" })).rejects.toMatchObject(
      notFound,
    );
  });

  test("to list what was in it", async () => {
    await expect(
      owner.list({ parentId: "etrash_folder" }),
    ).rejects.toMatchObject(notFound);
  });

  test("to favourite or archive", async () => {
    await expect(
      owner.updateUserPrefs({ entityId: "etrash_doc", favorite: true }),
    ).rejects.toMatchObject(notFound);
  });
});

describe("favouriting a file needs one you can open", () => {
  test("someone else's, or one that does not exist, is not found", async () => {
    const other = callerOf(OTHER);
    for (const entityId of ["etrash_live", "etrash_nowhere"]) {
      await expect(
        other.updateUserPrefs({ entityId, favorite: true }),
      ).rejects.toMatchObject(notFound);
    }
    const prefs = await db
      .select()
      .from(schema.userEntityPrefs)
      .where(eq(schema.userEntityPrefs.userId, OTHER));
    expect(prefs).toEqual([]);
  });

  test("even when it changes nothing", async () => {
    await expect(
      callerOf(OTHER).updateUserPrefs({ entityId: "etrash_live" }),
    ).rejects.toMatchObject(notFound);
    const prefs = await db
      .select()
      .from(schema.userEntityPrefs)
      .where(eq(schema.userEntityPrefs.userId, OTHER));
    expect(prefs).toEqual([]);
  });
});

test("someone a file is shared with for editing can ask for a new thumbnail", async () => {
  await expect(
    callerOf(EDITOR).regenerateThumbnail({ id: "etrash_live" }),
  ).resolves.toEqual({ ok: true });
});
