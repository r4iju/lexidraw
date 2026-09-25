/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");
const { documentRouter } = await import("~/server/api/routers/documents");

const OWNER = "etag_owner";
const EDITOR = "etag_editor";
const DOC = "etag_doc";

function callers(userId: string | null) {
  const context = {
    drizzle: db,
    schema,
    session: userId ? { user: { id: userId } } : null,
    auth: { kind: "session" },
    headers: new Headers(),
  } as never;
  return {
    entities: entityRouter.createCaller(context),
    documents: documentRouter.createCaller(context),
  };
}

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "etag-owner@example.test" },
    { id: EDITOR, name: "Editor", email: "etag-editor@example.test" },
  ]);
  const at = new Date("2026-09-01T00:00:00.000Z");
  await db.insert(schema.entities).values({
    id: DOC,
    title: "Plan",
    elements: JSON.stringify({
      root: {
        type: "root",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [],
      },
    }),
    entityType: "document",
    userId: OWNER,
    publicAccess: PublicAccess.READ,
    createdAt: at,
    updatedAt: at,
  });
  await db.insert(schema.sharedEntities).values({
    id: `${DOC}-${EDITOR}`,
    entityId: DOC,
    userId: EDITOR,
    accessLevel: AccessLevel.EDIT,
  });
  await db.insert(schema.tags).values([
    { id: "etag_roadmap", name: "etag-roadmap" },
    { id: "etag_personal", name: "etag-personal" },
  ]);
  await db.insert(schema.entityTags).values([
    { entityId: DOC, tagId: "etag_roadmap", userId: OWNER },
    { entityId: DOC, tagId: "etag_personal", userId: EDITOR },
  ]);
});

describe("the tags on a document are the reader's own", () => {
  test("a markdown read carries only the reader's tags", async () => {
    const owner = await callers(OWNER).documents.getMarkdown({ id: DOC });
    expect(owner.tags).toEqual(["etag-roadmap"]);
    expect(owner.content).not.toContain("etag-personal");

    const editor = await callers(EDITOR).documents.getMarkdown({ id: DOC });
    expect(editor.tags).toEqual(["etag-personal"]);
    expect(editor.content).not.toContain("etag-roadmap");

    const visitor = await callers(null).documents.getMarkdown({ id: DOC });
    expect(visitor.tags).toEqual([]);
    expect(visitor.content).not.toContain("etag-");
  });

  test("searching finds a document by the searcher's tags only", async () => {
    const owner = callers(OWNER).entities;
    expect(
      (await owner.deepSearch({ query: "etag-roadmap" })).map((h) => h.id),
    ).toEqual([DOC]);
    expect(await owner.deepSearch({ query: "etag-personal" })).toEqual([]);
  });
});
