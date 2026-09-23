/// <reference types="bun" />
import { beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import * as schema from "@packages/drizzle/drizzle-schema";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { PublicAccess } from "@packages/types";
import type { DocumentStore } from "./write";
import { drizzleDocumentStore } from "./document-store";

// The Entities columns as `schema.entities` declares them, without the
// foreign keys, so the table stands on its own in memory.
const CREATE_ENTITIES = `
  CREATE TABLE "Entities" (
    "id" text PRIMARY KEY NOT NULL,
    "title" text NOT NULL,
    "elements" text NOT NULL,
    "appState" text,
    "entityType" text NOT NULL DEFAULT 'drawing',
    "parentId" text,
    "screenShotLight" text NOT NULL DEFAULT '',
    "screenShotDark" text NOT NULL DEFAULT '',
    "createdAt" integer NOT NULL,
    "updatedAt" integer NOT NULL,
    "deletedAt" integer,
    "userId" text NOT NULL,
    "publicAccess" text NOT NULL,
    "isActive" integer NOT NULL DEFAULT 1,
    "thumbnailStatus" text DEFAULT 'pending',
    "thumbnailUpdatedAt" integer,
    "thumbnailVersion" text
  )
`;

const AT = new Date("2026-09-23T10:00:00.000Z");

/** The write, for the cases where losing the race is itself the failure. */
async function mustWrite(
  store: DocumentStore,
  elements: string,
  expectedUpdatedAt: Date,
) {
  const written = await store.write("doc_1", elements, expectedUpdatedAt);
  if (!written) throw new Error("expected the compare-and-set to win");
  return written;
}

let db: LibSQLDatabase<typeof schema>;

async function seed(row: { id: string; updatedAt: Date; deletedAt?: Date }) {
  await db.insert(schema.entities).values({
    id: row.id,
    title: "Doc",
    elements: "before",
    entityType: "document",
    createdAt: AT,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    userId: "user_1",
    publicAccess: PublicAccess.PRIVATE,
  });
}

beforeEach(async () => {
  const client = createClient({ url: ":memory:" });
  await client.execute(CREATE_ENTITIES);
  db = drizzle(client, { schema });
});

describe("drizzleDocumentStore", () => {
  test("a deleted document reads as gone", async () => {
    await seed({ id: "doc_1", updatedAt: AT });
    await seed({ id: "doc_2", updatedAt: AT, deletedAt: new Date() });
    const store = drizzleDocumentStore(db);

    expect(await store.read("doc_1")).toMatchObject({ elements: "before" });
    expect(await store.read("doc_2")).toBeNull();
    expect(await store.read("doc_3")).toBeNull();
  });

  test("a matching updatedAt writes and moves the token forward", async () => {
    await seed({ id: "doc_1", updatedAt: AT });
    const store = drizzleDocumentStore(db);

    const written = await mustWrite(store, "after", AT);

    expect(written.id).toBe("doc_1");
    expect(written.updatedAt).toBeInstanceOf(Date);
    expect(written.updatedAt.getTime()).toBeGreaterThan(AT.getTime());
    expect(await store.read("doc_1")).toEqual({
      id: "doc_1",
      elements: "after",
      updatedAt: written.updatedAt,
    });
  });

  test("the token advances even when two writes share a millisecond", async () => {
    // Seeded at "now", so a wall-clock stamp would not move the token.
    const now = new Date();
    await seed({ id: "doc_1", updatedAt: now });
    const store = drizzleDocumentStore(db);

    const first = await mustWrite(store, "one", now);
    const second = await mustWrite(store, "two", first.updatedAt);

    expect(first.updatedAt.getTime()).toBeGreaterThan(now.getTime());
    expect(second.updatedAt.getTime()).toBeGreaterThan(
      first.updatedAt.getTime(),
    );
  });

  test("a stale updatedAt writes nothing", async () => {
    await seed({ id: "doc_1", updatedAt: AT });
    const store = drizzleDocumentStore(db);

    const written = await store.write(
      "doc_1",
      "after",
      new Date("2026-01-01T00:00:00.000Z"),
    );

    expect(written).toBeNull();
    expect(await store.read("doc_1")).toEqual({
      id: "doc_1",
      elements: "before",
      updatedAt: AT,
    });
  });

  test("a deleted document is never written to", async () => {
    await seed({ id: "doc_1", updatedAt: AT, deletedAt: new Date() });
    const store = drizzleDocumentStore(db);

    expect(await store.write("doc_1", "after", AT)).toBeNull();
    const rows = await db.select().from(schema.entities);
    expect(rows[0]?.elements).toBe("before");
  });
});
