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

const storedRow = async (id: string) =>
  (
    await db
      .select({
        title: schema.entities.title,
        elements: schema.entities.elements,
      })
      .from(schema.entities)
      .where(eq(schema.entities.id, id))
  )[0];
const stored = async (id: string) => (await storedRow(id))?.elements;

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: OWNER, name: "Owner", email: "ecreate-owner@example.test" });
});

describe("creating a file with nothing in it", () => {
  test("starts each kind as the editor opens a new one, titled as new", async () => {
    for (const [id, entityType] of [
      ["ecreate_doc", "document"],
      ["ecreate_drawing", "drawing"],
      ["ecreate_folder", "directory"],
    ] as const)
      await caller.create({ id, entityType, parentId: null });

    const [doc, drawing, folder] = await Promise.all(
      ["ecreate_doc", "ecreate_drawing", "ecreate_folder"].map(storedRow),
    );
    expect([
      [doc?.title, JSON.parse(doc?.elements ?? "null")],
      [drawing?.title, drawing?.elements],
      [folder?.title, folder?.elements],
    ]).toEqual([
      ["New document", EMPTY_CONTENT],
      ["New drawing", "[]"],
      ["New folder", "{}"],
    ]);
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
