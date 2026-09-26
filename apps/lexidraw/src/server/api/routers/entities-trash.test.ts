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
  // For restoring: a live folder of the owner's and one of someone else's
  // they could edit in once and now only read, each with a file of the
  // owner's that went to the trash from it, and a file that went from the
  // folder that is in the trash itself.
  await db.insert(schema.entities).values([
    { ...row("etrash_home", "directory", null) },
    {
      ...row("etrash_theirs", "directory", null),
      userId: OTHER,
    },
    {
      ...row("etrash_back", "document", new Date("2026-09-03T00:00:00.000Z")),
      parentId: "etrash_home",
    },
    {
      ...row("etrash_orphan", "document", new Date("2026-09-04T00:00:00.000Z")),
      parentId: "etrash_folder",
    },
    {
      ...row("etrash_left", "document", new Date("2026-09-05T00:00:00.000Z")),
      parentId: "etrash_theirs",
    },
    row("etrash_given", "document", new Date("2026-09-02T00:00:00.000Z")),
  ]);
  await db.insert(schema.sharedEntities).values([
    {
      id: "etrash_theirs_share",
      entityId: "etrash_theirs",
      userId: OWNER,
      accessLevel: AccessLevel.READ,
    },
    {
      id: "etrash_given_share",
      entityId: "etrash_given",
      userId: EDITOR,
      accessLevel: AccessLevel.EDIT,
    },
  ]);
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

describe("the trash", () => {
  test("lists what its owner put there, last in first", async () => {
    const trash = await owner.trash();
    expect(trash.slice(0, 4).map((entity) => entity.id)).toEqual([
      "etrash_left",
      "etrash_orphan",
      "etrash_back",
      "etrash_given",
    ]);
    expect(trash.map((entity) => entity.id).toSorted()).toEqual(
      [
        "etrash_back",
        "etrash_doc",
        "etrash_folder",
        "etrash_given",
        "etrash_left",
        "etrash_orphan",
        "etrash_url",
      ].toSorted(),
    );
    expect(trash[0]?.deletedAt).toEqual(new Date("2026-09-05T00:00:00.000Z"));
  });

  test("is the owner's alone, even for someone a trashed file was shared with", async () => {
    expect(await callerOf(EDITOR).trash()).toEqual([]);
  });
});

describe("restoring a file from the trash", () => {
  test("puts it back in the folder it went from", async () => {
    const restored = await owner.restore({ id: "etrash_back" });
    expect(restored.parentId).toBe("etrash_home");
    const listed = await owner.list({ parentId: "etrash_home" });
    expect(listed.map((entity) => entity.id)).toEqual(["etrash_back"]);
    expect((await owner.trash()).map((entity) => entity.id)).not.toContain(
      "etrash_back",
    );
  });

  test("puts it at the top of Home when its folder is in the trash too", async () => {
    const restored = await owner.restore({ id: "etrash_orphan" });
    expect(restored.parentId).toBeNull();
    const home = await owner.list({});
    expect(home.map((entity) => entity.id)).toContain("etrash_orphan");
  });

  test("puts it at the top of Home when its owner may no longer write in its folder", async () => {
    const restored = await owner.restore({ id: "etrash_left" });
    expect(restored.parentId).toBeNull();
  });

  test("is its owner's to do, not an editor's", async () => {
    await expect(
      callerOf(EDITOR).restore({ id: "etrash_given" }),
    ).rejects.toMatchObject(notFound);
    await expect(
      callerOf(OTHER).restore({ id: "etrash_given" }),
    ).rejects.toMatchObject(notFound);
  });

  test("finds nothing to restore in a file that is not in the trash", async () => {
    await expect(owner.restore({ id: "etrash_live" })).rejects.toMatchObject(
      notFound,
    );
  });
});
