/// <reference types="bun" />
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
/** The arguments each read-aloud run was started with. */
const started: unknown[][] = [];
let refuseToStart = false;
mock.module("workflow/api", () => ({
  start: async (_workflow: unknown, args: unknown[]) => {
    if (refuseToStart) throw new Error("The workflow queue is down");
    started.push(args);
    return {};
  },
}));
const { ttsRouter } = await import("~/server/api/routers/tts");

const OWNER = "runs_owner";
const READER = "runs_reader";
const DOC = "runs_doc";
const ARTICLE = "runs_article";
const callerOf = (userId: string) =>
  ttsRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const at = new Date("2026-09-01T00:00:00.000Z");

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "runs-owner@example.test" },
    { id: READER, name: "Reader", email: "runs-reader@example.test" },
  ]);
  await db.insert(schema.entities).values([
    {
      id: DOC,
      title: "Report",
      elements: JSON.stringify({
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "paragraph",
              version: 1,
              children: [{ type: "text", version: 1, text: "Numbers." }],
            },
          ],
        },
      }),
      entityType: "document",
      userId: OWNER,
      publicAccess: PublicAccess.READ,
      createdAt: at,
      updatedAt: at,
    },
    {
      id: ARTICLE,
      title: "Post",
      elements: JSON.stringify({
        url: "https://example.com/post",
        distilled: { contentHtml: "<p>The post.</p>" },
      }),
      entityType: "url",
      userId: OWNER,
      publicAccess: PublicAccess.PRIVATE,
      createdAt: at,
      updatedAt: at,
    },
  ]);
});

beforeEach(async () => {
  started.length = 0;
  refuseToStart = false;
  await db.delete(schema.ttsJobs);
});

const jobsOf = (entityId: string) =>
  db.select().from(schema.ttsJobs).where(eq(schema.ttsJobs.entityId, entityId));

describe("legacy durable runs after the AI Power migration", () => {
  test.each(["queued", "processing", "error", "cancelled"] as const)(
    "preserves a %s run without restarting paid synthesis",
    async (status) => {
      await db.insert(schema.ttsJobs).values({
        id: "legacy-run",
        entityId: DOC,
        userId: OWNER,
        status,
        runId: "old-durable-run",
      });
      const before = await callerOf(OWNER).getDocumentTtsStatus({
        documentId: DOC,
      });
      await expect(
        callerOf(OWNER).startDocumentTts({
          documentId: DOC,
          markdown: "Numbers.",
          voiceId: "nova",
        }),
      ).rejects.toThrow("Coming soon");
      await expect(callerOf(OWNER).listen({ id: DOC })).rejects.toThrow(
        "Coming soon",
      );
      expect(
        await callerOf(OWNER).getDocumentTtsStatus({ documentId: DOC }),
      ).toEqual(before);
      expect(started).toEqual([]);
    },
  );
  test("article and shared-reader calls cannot create a new system-key run", async () => {
    await expect(
      callerOf(OWNER).startArticleTts({
        articleId: ARTICLE,
        plainText: "The post.",
      }),
    ).rejects.toThrow("Coming soon");
    await expect(callerOf(READER).listen({ id: DOC })).rejects.toThrow(
      "Coming soon",
    );
    expect(started).toEqual([]);
    expect(await jobsOf(DOC)).toEqual([]);
  });
});
