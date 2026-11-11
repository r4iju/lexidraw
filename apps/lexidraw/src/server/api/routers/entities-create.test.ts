/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { EMPTY_CONTENT } from "@packages/lexical-nodes";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");
const { documentRouter } = await import("~/server/api/routers/documents");
const { drawingRouter } = await import("~/server/api/routers/drawings");

const OWNER = "ecreate_owner";
const STRANGER = "ecreate_stranger";
const contextOf = (userId: string) =>
  ({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  }) as never;
const callerOf = (userId: string) =>
  entityRouter.createCaller(contextOf(userId));
const caller = callerOf(OWNER);

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
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "ecreate-owner@example.test" },
    { id: STRANGER, name: "Stranger", email: "ecreate-stranger@example.test" },
  ]);
});

describe("creating a file with nothing in it", () => {
  test("starts each kind as the editor opens a new one, titled as new", async () => {
    const ids = {
      document: "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a01",
      drawing: "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a02",
      directory: "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a03",
    } as const;
    for (const [entityType, id] of Object.entries(ids))
      await caller.create({
        id,
        entityType: entityType as keyof typeof ids,
        parentId: null,
      });

    const [doc, drawing, folder] = await Promise.all(
      Object.values(ids).map(storedRow),
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
      id: "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a04",
      title: "At home",
      entityType: "document",
    });

    expect(created.parentId).toBeNull();
  });

  test("is refused for a link, which is nothing without its address", async () => {
    const id = "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a05";
    await expect(
      caller.create({
        id,
        title: "A link",
        entityType: "url",
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await stored(id)).toBeUndefined();
  });
});

describe("a new entity's id", () => {
  const REFUSED = [
    "",
    " ",
    "6F1C2B9E-3D4A-4E5F-8A7B-0C1D2E3F4A10",
    "{6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a10}",
    "6f1c2b9e3d4a4e5f8a7b0c1d2e3f4a10",
    "../settings",
    "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a1/",
    "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a1.",
    "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a%2",
    "<b>6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a10</b>",
    "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a100",
    // The fourth group of an RFC 4122 UUID starts with 8, 9, a or b.
    "6f1c2b9e-3d4a-4e5f-ca7b-0c1d2e3f4a10",
    "__proto__",
  ];

  test("is refused unless it is a canonical lowercase UUID, and nothing is made", async () => {
    for (const id of REFUSED)
      for (const entityType of [
        "document",
        "drawing",
        "directory",
        "url",
      ] as const) {
        await expect(
          caller.create({
            id,
            entityType,
            title: "Planted",
            elements: entityType === "url" ? "{}" : undefined,
            parentId: null,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(await storedRow(id)).toBeUndefined();
      }
  });

  test("is refused the same way when the web app creates a document directly", async () => {
    const documents = documentRouter.createCaller(contextOf(OWNER));
    for (const id of REFUSED) {
      await expect(
        documents.create({ id, title: "Planted", elements: "{}" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await storedRow(id)).toBeUndefined();
    }
  });

  test("is refused the same way for a drawing created with its own id", async () => {
    const drawings = drawingRouter.createCaller(contextOf(OWNER));
    for (const id of REFUSED) {
      await expect(
        drawings.create({ id, title: "Planted" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await storedRow(id)).toBeUndefined();
    }
  });

  test("is a fresh lowercase UUID for a drawing created without one", async () => {
    const drawings = drawingRouter.createCaller(contextOf(OWNER));
    const first = await drawings.create({ title: "Unnamed" });
    const second = await drawings.create({ title: "Unnamed too" });

    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.id).not.toBe(first.id);
    expect((await storedRow(first.id))?.title).toBe("Unnamed");
  });

  test("of any UUID version is taken, given back to its owner on a repeat, and refused to anyone else", async () => {
    // Version 7: the contract is the shape, not the generator.
    const id = "01937a1e-5b2c-7d3e-9f40-a1b2c3d4e5f6";
    const made = await caller.create({
      id,
      entityType: "document",
      title: "Mine",
    });
    const repeated = await caller.create({
      id,
      entityType: "document",
      title: "Mine again",
    });

    expect(repeated).toEqual(made);
    await expect(
      callerOf(STRANGER).create({
        id,
        entityType: "document",
        title: "Theirs",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await storedRow(id))?.title).toBe("Mine");
  });
});
