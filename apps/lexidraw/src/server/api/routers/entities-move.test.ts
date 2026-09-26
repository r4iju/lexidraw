/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "emove_owner";
const EDITOR = "emove_editor";
const OTHER = "emove_other";
const callerOf = (userId: string) =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const owner = callerOf(OWNER);
const editor = callerOf(EDITOR);

const at = new Date("2026-09-01T00:00:00.000Z");
const row = (
  id: string,
  userId: string,
  entityType: string,
  parentId: string | null,
  extra: Partial<typeof schema.entities.$inferInsert> = {},
) => ({
  id,
  title: id,
  elements: "{}",
  entityType,
  userId,
  parentId,
  publicAccess: PublicAccess.PRIVATE,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "emove-owner@example.test" },
    { id: EDITOR, name: "Editor", email: "emove-editor@example.test" },
    { id: OTHER, name: "Other", email: "emove-other@example.test" },
  ]);
  await db.insert(schema.entities).values([
    row("emove_home", OWNER, "directory", null),
    row("emove_inner", OWNER, "directory", "emove_home"),
    row("emove_doc", OWNER, "document", "emove_home"),
    row("emove_other_doc", OWNER, "document", null),
    row("emove_trashed", OWNER, "directory", null, { deletedAt: at }),
    row("emove_others", OTHER, "directory", null),
    row("emove_others_public", OTHER, "directory", null, {
      publicAccess: PublicAccess.READ,
    }),
    row("emove_team", OTHER, "directory", null),
    row("emove_editors", EDITOR, "directory", null),
  ]);
  await db.insert(schema.sharedEntities).values([
    {
      id: "emove_share_team",
      entityId: "emove_team",
      userId: OWNER,
      accessLevel: AccessLevel.EDIT,
    },
    {
      id: "emove_share_doc",
      entityId: "emove_doc",
      userId: EDITOR,
      accessLevel: AccessLevel.EDIT,
    },
  ]);
});

async function parentOf(id: string) {
  const [stored] = await db
    .select({ parentId: schema.entities.parentId })
    .from(schema.entities)
    .where(eq(schema.entities.id, id));
  return stored?.parentId;
}

describe("moving a file checks where it goes", () => {
  test.each([
    ["a folder of someone else's", "emove_others"],
    ["a folder someone else lets anyone read", "emove_others_public"],
    ["a folder in the trash", "emove_trashed"],
    ["a folder that does not exist", "emove_nowhere"],
    ["something that is not a folder", "emove_other_doc"],
  ])("into %s is refused and leaves it where it was", async (_, parentId) => {
    await expect(
      owner.update({ id: "emove_doc", parentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.save({ id: "emove_doc", elements: "{}", parentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await parentOf("emove_doc")).toBe("emove_home");
  });

  test("a folder cannot go inside itself or a folder below it", async () => {
    for (const parentId of ["emove_home", "emove_inner"]) {
      await expect(
        owner.update({ id: "emove_home", parentId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await parentOf("emove_home")).toBeNull();
  });

  test("an editor cannot take someone's file into a folder its owner can't open", async () => {
    await expect(
      editor.update({ id: "emove_doc", parentId: "emove_editors" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await parentOf("emove_doc")).toBe("emove_home");
  });

  test("into a folder shared for editing, and back to the top of Home", async () => {
    await owner.update({ id: "emove_doc", parentId: "emove_team" });
    expect(await parentOf("emove_doc")).toBe("emove_team");
    await owner.update({ id: "emove_doc", parentId: null });
    expect(await parentOf("emove_doc")).toBeNull();
    await owner.save({
      id: "emove_doc",
      elements: "{}",
      parentId: "emove_inner",
    });
    expect(await parentOf("emove_doc")).toBe("emove_inner");
  });
});
