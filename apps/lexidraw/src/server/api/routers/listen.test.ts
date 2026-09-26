/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { EMPTY_CONTENT } from "@packages/lexical-nodes";
import { PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
/** The arguments each read-aloud job was started with. */
const started: unknown[][] = [];
mock.module("workflow/api", () => ({
  start: async (_workflow: unknown, args: unknown[]) => {
    started.push(args);
    return {};
  },
}));
const { ttsRouter } = await import("~/server/api/routers/tts");

const OWNER = "lsn_owner";
const STRANGER = "lsn_stranger";
const DOC = "lsn_doc";
const EMPTY = "lsn_empty";
const ARTICLE = "lsn_article";
const DRAWING = "lsn_drawing";
const UNREAD = "lsn_unread";
const OGG_LISTENER = "lsn_ogg";
const OGG_DOC = "lsn_ogg_doc";
const MANIFEST = "https://blob.test/tts/doc/lsn/manifest.json";
const callerOf = (userId: string) =>
  ttsRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const at = new Date("2026-09-01T00:00:00.000Z");
const row = (id: string, entityType: string, elements: string) => ({
  id,
  title: `${id} title`,
  elements,
  entityType,
  userId: OWNER,
  publicAccess: PublicAccess.PRIVATE,
  createdAt: at,
  updatedAt: at,
});
const paragraph = (text: string) => ({
  type: "paragraph",
  version: 1,
  children: [{ type: "text", version: 1, text }],
});

const realFetch = globalThis.fetch;
beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input) === MANIFEST
      ? Response.json({
          segments: [
            {
              index: 0,
              text: "Quarterly numbers.",
              audioUrl: "https://blob.test/tts/chunks/a.mp3",
              sectionTitle: "Summary",
            },
            {
              index: 1,
              text: "They went up.",
              audioUrl: "https://blob.test/tts/chunks/b.mp3",
            },
          ],
        })
      : realFetch(input)) as typeof fetch;
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "lsn-owner@example.test" },
    { id: STRANGER, name: "Stranger", email: "lsn-stranger@example.test" },
    {
      id: OGG_LISTENER,
      name: "Ogg",
      email: "lsn-ogg@example.test",
      config: { tts: { voiceId: "nova", format: "ogg" } },
    },
  ]);
  await db.insert(schema.entities).values([
    row(
      DOC,
      "document",
      JSON.stringify({
        root: {
          type: "root",
          version: 1,
          children: [paragraph("Quarterly numbers went up.")],
        },
      }),
    ),
    row(EMPTY, "document", JSON.stringify(EMPTY_CONTENT)),
    row(
      ARTICLE,
      "url",
      JSON.stringify({
        url: "https://example.com/post",
        distilled: { contentHtml: "<p>The page, as it was read.</p>" },
      }),
    ),
    row(DRAWING, "drawing", "[]"),
    row(UNREAD, "url", JSON.stringify({ url: "https://example.com/later" })),
    {
      ...row(
        OGG_DOC,
        "document",
        JSON.stringify({
          root: { type: "root", version: 1, children: [paragraph("Hi.")] },
        }),
      ),
      userId: OGG_LISTENER,
    },
  ]);
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("listening to a file", () => {
  test("reads a document from what it stores, as the web reads it from the editor", async () => {
    started.length = 0;

    const listening = await callerOf(OWNER).listen({ id: DOC });

    expect(listening).toEqual({ status: "queued", segments: [] });
    const [documentId, markdown] = started[0] ?? [];
    expect(documentId).toBe(DOC);
    expect(markdown).toBe("Quarterly numbers went up.");
  });

  test("reads an article from its page's text", async () => {
    started.length = 0;

    await callerOf(OWNER).listen({ id: ARTICLE });

    const [articleId, plainText, html] = started[0] ?? [];
    expect(articleId).toBe(ARTICLE);
    expect(plainText).toBe("The page, as it was read.");
    expect(html).toBe("<p>The page, as it was read.</p>");
  });

  test("answers audio already made rather than making it again", async () => {
    await callerOf(OWNER).listen({ id: DOC });
    await db
      .update(schema.ttsJobs)
      .set({ status: "ready", manifestUrl: MANIFEST, segmentCount: 2 })
      .where(eq(schema.ttsJobs.entityId, DOC));
    started.length = 0;

    const listening = await callerOf(OWNER).listen({ id: DOC });

    expect(started).toEqual([]);
    expect(listening).toMatchObject({
      status: "ready",
      segments: [
        {
          index: 0,
          text: "Quarterly numbers.",
          audioUrl: "https://blob.test/tts/chunks/a.mp3",
          sectionTitle: "Summary",
        },
        {
          index: 1,
          text: "They went up.",
          audioUrl: "https://blob.test/tts/chunks/b.mp3",
        },
      ],
    });
  });

  /** The web's Listen asks in these too, so both play one copy. */
  test("is made in the caller's own read-aloud settings, Ogg included", async () => {
    started.length = 0;

    await callerOf(OGG_LISTENER).listen({ id: OGG_DOC });

    const [, , config] = started[0] ?? [];
    expect(config).toMatchObject({ voiceId: "nova", format: "ogg" });
  });

  test("of a document with nothing in it is refused, saying so", async () => {
    await expect(callerOf(OWNER).listen({ id: EMPTY })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "There is nothing in this document to read aloud",
    });
  });

  test("of a link whose page was never read is refused, saying so", async () => {
    await expect(callerOf(OWNER).listen({ id: UNREAD })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This link's page hasn't been read yet",
    });
  });

  test("that is neither a document nor a link is refused", async () => {
    await expect(callerOf(OWNER).listen({ id: DRAWING })).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
  });

  test("the caller can't open is not found", async () => {
    await expect(callerOf(STRANGER).listen({ id: DOC })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      callerOf(STRANGER).listening({ id: DOC }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("how far a file's audio is", () => {
  test("is none before anyone listened", async () => {
    await db.delete(schema.ttsJobs).where(eq(schema.ttsJobs.entityId, ARTICLE));

    expect(await callerOf(OWNER).listening({ id: ARTICLE })).toEqual({
      status: "none",
      segments: [],
    });
  });

  test("says how many parts are made while it is being made", async () => {
    await callerOf(OWNER).listen({ id: ARTICLE });
    await db
      .update(schema.ttsJobs)
      .set({ status: "processing", plannedCount: 4, segmentCount: 1 })
      .where(eq(schema.ttsJobs.entityId, ARTICLE));

    expect(await callerOf(OWNER).listening({ id: ARTICLE })).toEqual({
      status: "processing",
      plannedCount: 4,
      segmentCount: 1,
      segments: [],
    });
  });

  test("is of the caller's voice, whatever others made since", async () => {
    await db.insert(schema.ttsJobs).values({
      id: "lsn_another_voice",
      entityId: ARTICLE,
      userId: STRANGER,
      status: "error",
      error: "Not this one",
      createdAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(Date.now() + 60_000),
    });

    expect(await callerOf(OWNER).listening({ id: ARTICLE })).toMatchObject({
      status: "processing",
    });
  });

  test("says why it failed", async () => {
    await db
      .update(schema.ttsJobs)
      .set({ status: "error", error: "The voice service refused" })
      .where(eq(schema.ttsJobs.userId, OWNER));

    expect(await callerOf(OWNER).listening({ id: ARTICLE })).toMatchObject({
      status: "error",
      error: "The voice service refused",
    });
  });
});
