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

describe("loading a file says whether it is shared, never with whom", () => {
  test("to its owner, its editors and its readers alike", async () => {
    for (const userId of [OWNER, EDITOR, READER]) {
      const loaded = await callerOf(userId).load({ id: "erd_doc" });
      expect(loaded.shared).toBe(true);
      expect("sharedWith" in loaded).toBe(false);
      for (const sharee of [EDITOR, READER].filter((id) => id !== userId)) {
        expect(mentions(loaded, sharee)).toBe(false);
      }
    }
  });

  test("and that a file shared with nobody is not", async () => {
    const loaded = await callerOf(null).load({ id: "erd_public" });
    expect(loaded.shared).toBe(false);
  });
});

describe("who a file is shared with is for its owner to see", () => {
  test("its owner sees everyone it is shared with, by name and email", async () => {
    const shares = await callerOf(OWNER).getSharedInfo({ id: "erd_doc" });
    expect(shares.map((s) => s.email).toSorted()).toEqual([
      "erd-editor@example.test",
      "erd-reader@example.test",
    ]);
  });

  test("someone it is shared with, to edit or to read, is told it isn't there", async () => {
    for (const userId of [EDITOR, READER]) {
      await expect(
        callerOf(userId).getSharedInfo({ id: "erd_doc" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("who has a file is for its owner to change", () => {
  test("someone it is shared with to edit is told it isn't there", async () => {
    const editor = callerOf(EDITOR);
    await expect(
      editor.share({
        id: "erd_doc",
        userEmail: "erd-owner@example.test",
        accessLevel: AccessLevel.EDIT,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      editor.changeAccessLevel({
        id: "erd_doc",
        userId: READER,
        accessLevel: AccessLevel.EDIT,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      editor.unShare({ id: "erd_doc", userId: READER }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const shares = await callerOf(OWNER).getSharedInfo({ id: "erd_doc" });
    expect(shares.map((s) => [s.email, s.accessLevel]).toSorted()).toEqual([
      ["erd-editor@example.test", AccessLevel.EDIT],
      ["erd-reader@example.test", AccessLevel.READ],
    ]);
  });

  test("while its owner shares it", async () => {
    await expect(
      callerOf(OWNER).share({
        id: "erd_doc",
        userEmail: "erd-reader@example.test",
        accessLevel: AccessLevel.READ,
      }),
    ).resolves.toMatchObject({ success: true });
  });
});

describe("a listing says what the caller may do with each file, not whose it is", () => {
  test("to its owner, and to someone it is shared with", async () => {
    const owned = await callerOf(OWNER).list({ parentId: PRIVATE });
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every((entry) => entry.access === "owner")).toBe(true);

    const shared = await callerOf(READER).list({ parentId: "erd_shared" });
    expect(shared.map((entry) => [entry.id, entry.access])).toEqual([
      ["erd_doc", "read"],
    ]);
    for (const listed of [owned, shared]) {
      expect(mentions(listed, OWNER)).toBe(false);
    }
  });
});

describe("a file's details say whose it is only to its owner", () => {
  test("the owner is told it is theirs", async () => {
    const details = await callerOf(OWNER).getMetadata({ id: "erd_doc" });
    expect(details.access).toBe("owner");
    expect(details.parentId).toBe("erd_shared");
  });

  test("anyone else learns neither who owns it nor who else has it", async () => {
    for (const userId of [READER, null]) {
      const id = userId ? "erd_doc" : "erd_public";
      const details = await callerOf(userId).getMetadata({ id });
      expect(details.access).toBe("read");
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

  test("which can't be listed either", async () => {
    await expect(
      callerOf(READER).list({ parentId: PRIVATE }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
