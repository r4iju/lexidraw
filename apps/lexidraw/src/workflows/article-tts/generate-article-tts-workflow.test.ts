/// <reference types="bun" />
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
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
const store = fakeAudioStore({ madeBefore: () => true });
afterAll(store.restore);
const { generateArticleTtsWorkflow } = await import(
  "./generate-article-tts-workflow"
);
const { computeArticleKey } = await import("~/server/tts/id");

const ARTICLE = "wf_article";
const VOICE = {
  provider: "openai",
  voiceId: "alloy",
  speed: 1,
  format: "mp3" as const,
  languageCode: "en-US",
};
const KEY = computeArticleKey(ARTICLE, VOICE);
const HTML = Array.from(
  { length: 12 },
  (_, i) => `<h2>Part ${i}</h2><p>${"A sentence of the post. ".repeat(60)}</p>`,
).join("");

beforeAll(async () => {
  await db.insert(schema.users).values({
    id: "wf_reader",
    name: "Reader",
    email: "wf-reader@example.test",
  });
  await db.insert(schema.entities).values({
    id: ARTICLE,
    title: "Post",
    elements: "{}",
    entityType: "url",
    userId: "wf_reader",
    publicAccess: PublicAccess.PRIVATE,
  });
  await db.insert(schema.ttsJobs).values({
    id: KEY,
    entityId: ARTICLE,
    userId: "wf_reader",
    status: "queued",
    runId: "run-1",
  });
});

test("a run of an article whose job was cancelled makes no more parts", async () => {
  store.beforeChunk = async () => {
    await db
      .update(schema.ttsJobs)
      .set({ status: "cancelled" })
      .where(eq(schema.ttsJobs.id, KEY));
  };

  await generateArticleTtsWorkflow(ARTICLE, "", HTML, VOICE, "run-1");

  expect(store.chunksAsked).toHaveLength(4);
  const [job] = await db
    .select()
    .from(schema.ttsJobs)
    .where(eq(schema.ttsJobs.id, KEY));
  expect(job?.status).toBe("cancelled");
});
