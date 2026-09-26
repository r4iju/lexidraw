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

describe("starting a file's audio", () => {
  test("again while it is being made starts nothing more", async () => {
    await callerOf(OWNER).listen({ id: DOC });
    await callerOf(OWNER).listen({ id: DOC });
    await callerOf(OWNER).startDocumentTts({
      documentId: DOC,
      markdown: "Numbers.",
    });

    expect(started).toHaveLength(1);
  });

  test("for someone else in the same voice joins the run under way", async () => {
    await callerOf(OWNER).listen({ id: DOC });

    const joined = await callerOf(READER).listen({ id: DOC });

    expect(started).toHaveLength(1);
    expect(joined.status).toBe("queued");
  });

  test("hands each run its own id, which the job remembers", async () => {
    await callerOf(OWNER).listen({ id: ARTICLE });

    const [job] = await jobsOf(ARTICLE);
    const runId = started[0]?.at(-1);
    expect(typeof runId).toBe("string");
    expect(job?.runId).toBe(runId as string);
  });

  test("that stopped without saying so is started again", async () => {
    await callerOf(OWNER).listen({ id: DOC });
    await db
      .update(schema.ttsJobs)
      .set({
        status: "processing",
        updatedAt: new Date(Date.now() - 3_600_000),
      })
      .where(eq(schema.ttsJobs.entityId, DOC));

    await callerOf(OWNER).listen({ id: DOC });

    expect(started).toHaveLength(2);
    expect(started[1]?.at(-1)).not.toBe(started[0]?.at(-1));
  });

  test("that failed is started again", async () => {
    await callerOf(OWNER).listen({ id: DOC });
    await db
      .update(schema.ttsJobs)
      .set({ status: "error", error: "The voice service refused" })
      .where(eq(schema.ttsJobs.entityId, DOC));

    const again = await callerOf(OWNER).listen({ id: DOC });

    expect(started).toHaveLength(2);
    expect(again).toEqual({ status: "queued", segments: [] });
  });

  test("when the run cannot be started says so on the job", async () => {
    refuseToStart = true;

    await expect(callerOf(OWNER).listen({ id: DOC })).rejects.toThrow();

    const [job] = await jobsOf(DOC);
    expect(job).toMatchObject({
      status: "error",
      error: "The workflow queue is down",
    });
  });

  test("anew after the web deleted its audio makes it again", async () => {
    await callerOf(OWNER).startDocumentTts({
      documentId: DOC,
      markdown: "Numbers.",
    });
    await db
      .update(schema.ttsJobs)
      .set({ status: "ready" })
      .where(eq(schema.ttsJobs.entityId, DOC));

    await callerOf(OWNER).deleteDocumentTts({ documentId: DOC });
    await callerOf(OWNER).startDocumentTts({
      documentId: DOC,
      markdown: "Numbers.",
    });

    expect(started).toHaveLength(2);
  });
});

describe("the web choosing another voice", () => {
  test("stops the caller's run in the voice it chose before", async () => {
    await callerOf(OWNER).startDocumentTts({
      documentId: DOC,
      markdown: "Numbers.",
      voiceId: "alloy",
    });

    await callerOf(OWNER).startDocumentTts({
      documentId: DOC,
      markdown: "Numbers.",
      voiceId: "nova",
    });

    const statuses = (await jobsOf(DOC)).map((job) => job.status).sort();
    expect(statuses).toEqual(["cancelled", "queued"]);
  });

  test("is left running by a listen from the app", async () => {
    await callerOf(OWNER).startDocumentTts({
      documentId: DOC,
      markdown: "Numbers.",
      voiceId: "nova",
    });

    await callerOf(OWNER).listen({ id: DOC });

    const statuses = (await jobsOf(DOC)).map((job) => job.status);
    expect(statuses).toEqual(["queued", "queued"]);
  });
});
