/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "erd_owner";
const EDITOR = "erd_editor";
const READER = "erd_reader";
const callerOf = (userId: string | null) =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: userId ? { user: { id: userId } } : null,
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);

// Home › Private › Shared › Doc, all the owner's. The reader was given
// "Shared", "Doc" and "Loose"; "Private" is the owner's alone, and so is
// its id.
const PRIVATE = "erd_private";
const at = new Date("2026-09-01T00:00:00.000Z");
const row = (
  id: string,
  entityType: string,
  parentId: string | null,
  publicAccess: PublicAccess = PublicAccess.PRIVATE,
  elements = "{}",
) => ({
  id,
  title: `${id} title`,
  elements,
  entityType,
  userId: OWNER,
  parentId,
  publicAccess,
  createdAt: at,
  updatedAt: at,
});
const share = (entityId: string, userId: string, accessLevel: AccessLevel) => ({
  id: `${entityId}-${userId}`,
  entityId,
  userId,
  accessLevel,
});

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "erd-owner@example.test" },
    { id: EDITOR, name: "Editor", email: "erd-editor@example.test" },
    { id: READER, name: "Reader", email: "erd-reader@example.test" },
  ]);
  await db.insert(schema.entities).values([
    row(PRIVATE, "directory", null),
    row("erd_shared", "directory", PRIVATE),
    row("erd_doc", "document", "erd_shared"),
    row(
      "erd_loose",
      "document",
      PRIVATE,
      PublicAccess.PRIVATE,
      JSON.stringify({
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [{ type: "text", version: 1, text: "Quarterly" }],
            },
          ],
        },
      }),
    ),
    row("erd_public", "document", PRIVATE, PublicAccess.READ),
  ]);
  await db
    .insert(schema.sharedEntities)
    .values([
      share("erd_shared", READER, AccessLevel.READ),
      share("erd_doc", READER, AccessLevel.READ),
      share("erd_doc", EDITOR, AccessLevel.EDIT),
      share("erd_loose", READER, AccessLevel.READ),
    ]);
});

const mentions = (value: unknown, id: string) =>
  JSON.stringify(value).includes(id);

describe("who else has a file is for those who can edit it", () => {
  test("its owner and its editors see everyone it is shared with", async () => {
    for (const userId of [OWNER, EDITOR]) {
      const loaded = await callerOf(userId).load({ id: "erd_doc" });
      expect(loaded.sharedWith.map((s) => s.userId).toSorted()).toEqual([
        EDITOR,
        READER,
      ]);
    }
  });

  test("a reader sees only their own share", async () => {
    const loaded = await callerOf(READER).load({ id: "erd_doc" });
    expect(loaded.sharedWith).toEqual([
      { userId: READER, accessLevel: AccessLevel.READ },
    ]);
  });

  test("someone reading a public file sees no shares", async () => {
    const loaded = await callerOf(null).load({ id: "erd_public" });
    expect(loaded.sharedWith).toEqual([]);
  });
});

describe("a file's details say whose it is only to its owner", () => {
  test("the owner is told it is theirs", async () => {
    const details = await callerOf(OWNER).getMetadata({ id: "erd_doc" });
    expect(details.isOwner).toBe(true);
    expect(details.parentId).toBe("erd_shared");
  });

  test("anyone else learns neither who owns it nor who else has it", async () => {
    for (const userId of [READER, null]) {
      const id = userId ? "erd_doc" : "erd_public";
      const details = await callerOf(userId).getMetadata({ id });
      expect(details.isOwner).toBe(false);
      expect(mentions(details, OWNER)).toBe(false);
      expect(mentions(details, EDITOR)).toBe(false);
    }
  });
});

describe("a folder someone can't open is not named by its id either", () => {
  test("in a file's details, or the folders above it", async () => {
    for (const id of ["erd_doc", "erd_loose"]) {
      const details = await callerOf(READER).getMetadata({ id });
      expect(mentions(details, PRIVATE)).toBe(false);
    }
    const loose = await callerOf(READER).getMetadata({ id: "erd_loose" });
    expect(loose.parentId).toBeNull();
    const shared = await callerOf(null).getMetadata({ id: "erd_public" });
    expect(mentions(shared, PRIVATE)).toBe(false);
  });

  test("in search results", async () => {
    const reader = callerOf(READER);
    const hits = await reader.search({ query: "erd_loose" });
    expect(hits.map((hit) => hit.id)).toEqual(["erd_loose"]);
    expect(hits[0]?.parentId).toBeNull();
    const deep = await reader.deepSearch({ query: "quarterly" });
    expect(deep.map((hit) => hit.id)).toEqual(["erd_loose"]);
    expect(mentions(deep, PRIVATE)).toBe(false);
  });

  test("in a listing", async () => {
    const listed = await callerOf(READER).list({ parentId: PRIVATE });
    expect(listed.map((entry) => entry.id).toSorted()).toEqual([
      "erd_loose",
      "erd_shared",
    ]);
    expect(listed.every((entry) => entry.parentId === null)).toBe(true);
  });

  test("while the owner still sees where everything is", async () => {
    const owner = callerOf(OWNER);
    const [hit] = await owner.search({ query: "erd_loose" });
    expect(hit?.parentId).toBe(PRIVATE);
    const listed = await owner.list({ parentId: PRIVATE });
    expect(listed.every((entry) => entry.parentId === PRIVATE)).toBe(true);
    const details = await owner.getMetadata({ id: "erd_doc" });
    expect(details.ancestors.map((folder) => folder.id)).toEqual([
      PRIVATE,
      "erd_shared",
    ]);
  });
});
