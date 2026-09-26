/// <reference types="bun" />
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { fakeAudioStore } from "~/test/audio-store";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { default: env } = await import("@packages/env");
const HOST = new URL(env.VERCEL_BLOB_STORAGE_HOST).origin;

// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  put: async (pathname: string) => ({ url: `${HOST}/${pathname}`, pathname }),
}));
// Every chunk is made already, so a run pays for nothing.
const store = fakeAudioStore({ madeBefore: () => true });
afterAll(store.restore);
const { generateDocumentTtsWorkflow } = await import(
  "./generate-document-tts-workflow"
);
const { computeDocKey } = await import("~/server/tts/id");

const DOC = "wf_doc";
const VOICE = {
  provider: "openai",
  voiceId: "alloy",
  speed: 1,
  format: "mp3" as const,
  languageCode: "en-US",
};
const KEY = computeDocKey(DOC, VOICE);
/** Twelve sections, so three batches of four chunks. */
const MARKDOWN = Array.from(
  { length: 12 },
  (_, i) => `## Part ${i}\n\n${"A sentence of the report. ".repeat(60)}`,
).join("\n\n");

const jobOf = async () =>
  (await db.select().from(schema.ttsJobs).where(eq(schema.ttsJobs.id, KEY)))[0];

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: "wf_owner", name: "Owner", email: "wf-owner@example.test" });
  await db.insert(schema.entities).values({
    id: DOC,
    title: "Report",
    elements: "{}",
    entityType: "document",
    userId: "wf_owner",
    publicAccess: PublicAccess.PRIVATE,
  });
});

beforeEach(async () => {
  store.chunksAsked.length = 0;
  store.beforeChunk = async () => {};
  await db.delete(schema.ttsJobs);
  await db.insert(schema.ttsJobs).values({
    id: KEY,
    entityId: DOC,
    userId: "wf_owner",
    status: "queued",
    runId: "run-1",
  });
});

describe("a read-aloud run", () => {
  test("makes every part and marks its job ready", async () => {
    await generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-1");

    expect(store.chunksAsked.length).toBeGreaterThan(8);
    expect(await jobOf()).toMatchObject({ status: "ready" });
  });

  test("whose job was cancelled makes no more parts", async () => {
    store.beforeChunk = async () => {
      await db
        .update(schema.ttsJobs)
        .set({ status: "cancelled" })
        .where(eq(schema.ttsJobs.id, KEY));
    };

    await generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-1");

    expect(store.chunksAsked).toHaveLength(4);
    expect(await jobOf()).toMatchObject({ status: "cancelled" });
  });

  test("whose job another run took over makes no more parts and leaves the job alone", async () => {
    store.beforeChunk = async () => {
      await db
        .update(schema.ttsJobs)
        .set({ runId: "run-2", status: "queued", segmentCount: 0 })
        .where(eq(schema.ttsJobs.id, KEY));
    };

    await generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-1");

    expect(store.chunksAsked).toHaveLength(4);
    expect(await jobOf()).toMatchObject({
      status: "queued",
      runId: "run-2",
      segmentCount: 0,
    });
  });

  test("whose job was deleted makes nothing", async () => {
    await db.delete(schema.ttsJobs);

    await generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-1");

    expect(store.chunksAsked).toEqual([]);
    expect(await jobOf()).toBeUndefined();
  });
});
