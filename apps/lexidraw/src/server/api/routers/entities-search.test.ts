/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "esearch_owner";
const READER = "esearch_reader";
const callerOf = (userId: string) =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const caller = callerOf(OWNER);

const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text, format: 0 }],
});

const LONG_BEFORE =
  "The service answers most requests quickly, and the team measured it over several weeks of traffic before writing this.";

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "esearch@example.test" },
    { id: READER, name: "Reader", email: "esearch-reader@example.test" },
  ]);
  const at = new Date("2026-09-01T00:00:00.000Z");
  const row = (
    id: string,
    title: string,
    entityType: string,
    parentId: string | null,
    elements = "{}",
  ) => ({
    id,
    title,
    elements,
    entityType,
    userId: OWNER,
    parentId,
    publicAccess: PublicAccess.PRIVATE,
    createdAt: at,
    updatedAt: at,
  });
  await db.insert(schema.entities).values([
    row("esearch_folder", "Design review", "directory", null),
    row(
      "esearch_prd",
      "Checkout PRD",
      "document",
      "esearch_folder",
      JSON.stringify({
        root: {
          type: "root",
          version: 1,
          children: [
            paragraph(LONG_BEFORE),
            paragraph("Every page stays inside a latency budget of 200 ms."),
          ],
        },
      }),
    ),
    row(
      "esearch_top",
      "Paragraph styles",
      "document",
      null,
      JSON.stringify({
        root: { type: "root", version: 1, children: [paragraph("Hello")] },
      }),
    ),
  ]);
  await db.insert(schema.sharedEntities).values({
    id: "esearch_share",
    entityId: "esearch_prd",
    userId: READER,
    accessLevel: AccessLevel.READ,
  });
});

describe("search results say where a file is and why it matched", () => {
  test("a title hit names the folder the file is in", async () => {
    const [hit] = await caller.search({ query: "checkout" });
    expect(hit?.id).toBe("esearch_prd");
    expect(hit?.folderTitle).toBe("Design review");
  });

  test("a file at the top of Home has no folder", async () => {
    const [hit] = await caller.search({ query: "paragraph styles" });
    expect(hit?.folderTitle).toBeNull();
  });

  test("a content hit carries the text around the match", async () => {
    const hits = await caller.deepSearch({ query: "latency" });
    expect(hits.map((hit) => hit.id)).toEqual(["esearch_prd"]);
    expect(hits[0]?.folderTitle).toBe("Design review");
    expect(hits[0]?.snippet).toContain("inside a latency budget of 200 ms");
    expect(hits[0]?.snippet?.length).toBeLessThan(140);
  });

  test("a file shared out of a folder someone can't open names no folder", async () => {
    const reader = callerOf(READER);
    const [hit] = await reader.search({ query: "checkout" });
    const [deepHit] = await reader.deepSearch({ query: "latency" });
    expect(hit?.id).toBe("esearch_prd");
    expect(hit?.folderTitle).toBeNull();
    expect(deepHit?.id).toBe("esearch_prd");
    expect(deepHit?.folderTitle).toBeNull();
  });

  test("the stored format's own words are not content", async () => {
    // Every document's JSON says "paragraph"; only its title does here.
    const hits = await caller.deepSearch({ query: "paragraph" });
    expect(hits).toEqual([]);
  });
});
