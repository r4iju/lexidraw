/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { EMPTY_CONTENT } from "@packages/lexical-nodes";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "ecreate_owner";
const caller = entityRouter.createCaller({
  drizzle: db,
  schema,
  session: { user: { id: OWNER } },
  auth: { kind: "session" },
  headers: new Headers(),
} as never);

const stored = async (id: string) =>
  (
    await db
      .select({ elements: schema.entities.elements })
      .from(schema.entities)
      .where(eq(schema.entities.id, id))
  )[0]?.elements;

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: OWNER, name: "Owner", email: "ecreate-owner@example.test" });
});

describe("creating a file with nothing in it", () => {
  test("starts each kind as the editor opens a new one", async () => {
    for (const [id, entityType] of [
      ["ecreate_doc", "document"],
      ["ecreate_drawing", "drawing"],
      ["ecreate_folder", "directory"],
    ] as const)
      await caller.create({ id, title: id, entityType, parentId: null });

    expect([
      JSON.parse((await stored("ecreate_doc")) ?? "null"),
      await stored("ecreate_drawing"),
      await stored("ecreate_folder"),
    ]).toEqual([EMPTY_CONTENT, "[]", "{}"]);
  });

  test("in no folder named is at the top of Home", async () => {
    const created = await caller.create({
      id: "ecreate_home",
      title: "At home",
      entityType: "document",
    });

    expect(created.parentId).toBeNull();
  });

  test("is refused for a link, which is nothing without its address", async () => {
    await expect(
      caller.create({
        id: "ecreate_url",
        title: "A link",
        entityType: "url",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await stored("ecreate_url")).toBeUndefined();
  });
});
