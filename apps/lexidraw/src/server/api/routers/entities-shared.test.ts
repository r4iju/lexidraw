/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { replaceOwnTags } from "~/server/entities/tags";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "eshared_owner";
const READER = "eshared_reader";
const callerOf = (userId: string) =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const reader = callerOf(READER);

// The owner keeps a private folder with a plan in it they gave the reader,
// a note at the top they gave the reader to edit, a draft they gave and then
// trashed, and a page anyone may read. The reader has a file of their own.
const row = (
  id: string,
  entityType: string,
  updatedAt: string,
  overrides: Partial<typeof schema.entities.$inferInsert> = {},
) => ({
  id,
  title: `${id} title`,
  elements: "{}",
  entityType,
  userId: OWNER,
  parentId: null,
  publicAccess: PublicAccess.PRIVATE,
  createdAt: new Date(updatedAt),
  updatedAt: new Date(updatedAt),
  ...overrides,
});
const share = (entityId: string, accessLevel: AccessLevel) => ({
  id: `${entityId}-${READER}`,
  entityId,
  userId: READER,
  accessLevel,
});

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "eshared-owner@example.test" },
    { id: READER, name: "Reader", email: "eshared-reader@example.test" },
  ]);
  await db.insert(schema.entities).values([
    row("eshared_private", "directory", "2026-09-01T00:00:00.000Z"),
    row("eshared_plan", "document", "2026-09-02T00:00:00.000Z", {
      parentId: "eshared_private",
    }),
    row("eshared_note", "drawing", "2026-09-03T00:00:00.000Z"),
    row("eshared_draft", "document", "2026-09-04T00:00:00.000Z", {
      deletedAt: new Date("2026-09-05T00:00:00.000Z"),
    }),
    row("eshared_public", "document", "2026-09-06T00:00:00.000Z", {
      publicAccess: PublicAccess.READ,
    }),
    row("eshared_own", "document", "2026-09-07T00:00:00.000Z", {
      userId: READER,
    }),
  ]);
  await db
    .insert(schema.sharedEntities)
    .values([
      share("eshared_plan", AccessLevel.READ),
      share("eshared_note", AccessLevel.EDIT),
      share("eshared_draft", AccessLevel.READ),
    ]);
  // Tagged by the reader while they could still edit it.
  await replaceOwnTags(db, "eshared_plan", READER, ["mine"]);
  await replaceOwnTags(db, "eshared_plan", OWNER, ["theirs"]);
});

describe("Shared with me", () => {
  test("lists what others gave the caller and they can open, newest first", async () => {
    const shared = await reader.sharedWithMe();
    expect(shared.map((entity) => entity.id)).toEqual([
      "eshared_note",
      "eshared_plan",
    ]);
    expect(shared.map((entity) => entity.access)).toEqual(["edit", "read"]);
  });

  test("never names a folder the caller cannot open", async () => {
    const shared = await reader.sharedWithMe();
    const plan = shared.find((entity) => entity.id === "eshared_plan");
    expect(plan?.parentId).toBeNull();
    expect(JSON.stringify(shared)).not.toContain("eshared_private");
    expect(JSON.stringify(shared)).not.toContain(OWNER);
  });

  test("shows the caller's own tags, not the owner's", async () => {
    const shared = await reader.sharedWithMe();
    const plan = shared.find((entity) => entity.id === "eshared_plan");
    expect(plan?.tags).toEqual(["mine"]);
  });

  test("is empty for the owner, who shared rather than was given", async () => {
    expect(await callerOf(OWNER).sharedWithMe()).toEqual([]);
  });
});
