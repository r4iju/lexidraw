/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "elist_owner";
const READER = "elist_reader";
const callerOf = (userId: string) =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const caller = callerOf(OWNER);

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "elist-owner@example.test" },
    { id: READER, name: "Reader", email: "elist-reader@example.test" },
  ]);
  const at = new Date("2026-09-01T00:00:00.000Z");
  const parent = "elist_folder";
  await db.insert(schema.entities).values(
    [parent, "elist_plain", "elist_favorite", "elist_archived"].map((id) => ({
      id,
      title: id,
      elements: "{}",
      entityType: id === parent ? "directory" : "document",
      userId: OWNER,
      parentId: id === parent ? null : parent,
      publicAccess: PublicAccess.PRIVATE,
      createdAt: at,
      updatedAt: at,
    })),
  );
  await db.insert(schema.sharedEntities).values(
    [parent, "elist_plain"].map((entityId) => ({
      id: `elist_share_${entityId}`,
      entityId,
      userId: READER,
      accessLevel: AccessLevel.READ,
    })),
  );
  await caller.updateUserPrefs({ entityId: "elist_favorite", favorite: true });
  await caller.updateUserPrefs({ entityId: "elist_archived", archive: true });
});

const titles = async (filters: Record<string, boolean>) =>
  (await caller.list({ parentId: "elist_folder", ...filters }))
    .map((entity) => entity.title)
    .sort();

describe("Home's views", () => {
  test("All hides what is archived", async () => {
    expect(await titles({})).toEqual(["elist_favorite", "elist_plain"]);
  });

  test("Favorites lists only favorites", async () => {
    expect(await titles({ onlyFavorites: true })).toEqual(["elist_favorite"]);
  });

  test("Archived lists only what is archived", async () => {
    expect(await titles({ onlyArchived: true })).toEqual(["elist_archived"]);
  });
});

describe("a folder's item count", () => {
  const countIn = async (userId: string) =>
    (await callerOf(userId).list({})).find(
      (entity) => entity.id === "elist_folder",
    )?.childCount;

  test("counts everything in it for its owner", async () => {
    expect(await countIn(OWNER)).toBe(3);
  });

  test("counts only what someone it was shared with can open", async () => {
    expect(await countIn(READER)).toBe(1);
  });
});

describe("a folder's folder count", () => {
  test("counts only the folders in it, so a tree opens only onto folders", async () => {
    const at = new Date("2026-09-01T00:00:00.000Z");
    const row = (id: string, entityType: string, parentId: string | null) => ({
      id,
      title: id,
      elements: "{}",
      entityType,
      userId: OWNER,
      parentId,
      publicAccess: PublicAccess.PRIVATE,
      createdAt: at,
      updatedAt: at,
    });
    await db
      .insert(schema.entities)
      .values([
        row("elist_tree", "directory", null),
        row("elist_branch", "directory", "elist_tree"),
        row("elist_leaf", "document", "elist_tree"),
      ]);

    const listed = await caller.list({});
    const counts = (id: string) => {
      const folder = listed.find((entity) => entity.id === id);
      return [folder?.childCount, folder?.folderCount];
    };

    expect([counts("elist_tree"), counts("elist_folder")]).toEqual([
      [2, 1],
      [3, 0],
    ]);
  });
});
