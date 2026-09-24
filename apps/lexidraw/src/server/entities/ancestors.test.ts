/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");
const { documentRouter } = await import("~/server/api/routers/documents");

const OWNER = "anc_owner";
const READER = "anc_reader";

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

// Home › Private › Shared › Public › Hidden › the document, all the owner's.
// The reader has "Shared" and the document shared with them; "Public" is
// readable by anyone; "Private" and "Hidden" are the owner's alone.
const chain = [
  { id: "anc_private", title: "Private", access: PublicAccess.PRIVATE },
  { id: "anc_shared", title: "Shared", access: PublicAccess.PRIVATE },
  { id: "anc_public", title: "Public", access: PublicAccess.READ },
  { id: "anc_hidden", title: "Hidden", access: PublicAccess.PRIVATE },
];
const DOC = "anc_doc";

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "anc-owner@example.test" },
    { id: READER, name: "Reader", email: "anc-reader@example.test" },
  ]);
  const at = new Date("2026-09-01T00:00:00.000Z");
  await db.insert(schema.entities).values([
    ...chain.map((folder, index) => ({
      id: folder.id,
      title: folder.title,
      elements: "{}",
      entityType: "directory",
      userId: OWNER,
      parentId: chain[index - 1]?.id ?? null,
      publicAccess: folder.access,
      createdAt: at,
      updatedAt: at,
    })),
    {
      id: DOC,
      title: "Doc",
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
      parentId: "anc_hidden",
      publicAccess: PublicAccess.PRIVATE,
      createdAt: at,
      updatedAt: at,
    },
  ]);
  await db.insert(schema.sharedEntities).values(
    ["anc_shared", DOC].map((entityId) => ({
      id: `share_${entityId}`,
      entityId,
      userId: READER,
      accessLevel: AccessLevel.READ,
    })),
  );
});

const ancestorTitles = async (userId: string) =>
  (await callers(userId).entities.getMetadata({ id: DOC })).ancestors.map(
    (ancestor) => ancestor.title,
  );

describe("the folders above an entity", () => {
  test("are all there for their owner, from the top down", async () => {
    expect(await ancestorTitles(OWNER)).toEqual([
      "Private",
      "Shared",
      "Public",
      "Hidden",
    ]);
  });

  test("are only the ones someone else can open", async () => {
    expect(await ancestorTitles(READER)).toEqual(["Shared", "Public"]);
  });

  test("name only the folders the reader can open in a markdown path", async () => {
    const owner = await callers(OWNER).documents.getMarkdown({ id: DOC });
    const reader = await callers(READER).documents.getMarkdown({ id: DOC });
    expect(owner.path).toBe("Private/Shared/Public/Hidden/Doc");
    expect(reader.path).toBe("Shared/Public/Doc");
  });
});
