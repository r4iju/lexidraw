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
// A part not made before is asked of OpenAI, which the fake store answers.
Object.assign(env, { OPENAI_API_KEY: env.OPENAI_API_KEY || "sk-test" });

// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
/** What each run publishes as its plan, by path. */
const plans = new Map<string, { segments: { audioUrl: string }[] }>();
mock.module("@vercel/blob", () => ({
  ...realBlob,
  put: async (pathname: string, body: unknown) => {
    if (pathname.startsWith("tts/plans/"))
      plans.set(pathname, JSON.parse(String(body)));
    return { url: `${HOST}/${pathname}`, pathname };
  },
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
/** Twelve sections, and as many parts or more. */
const MARKDOWN = Array.from(
  { length: 12 },
  (_, i) =>
    `## Part ${i}\n\n${`A sentence of part ${i} of the report. `.repeat(60)}`,
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
  store.madeBefore = () => true;
  store.speech = () => new Response(new Uint8Array([1, 2, 3]));
  store.paidFor.length = 0;
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

  test("publishes its parts first, then makes them in order, the first alone", async () => {
    const made: number[] = [];
    store.beforeChunk = async () => {
      made.push((await jobOf())?.segmentCount ?? 0);
    };

    await generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-1");

    const plan = plans.get(`tts/plans/${KEY}/run-1.json`);
    const job = await jobOf();
    expect(plan?.segments).toHaveLength(job?.plannedCount ?? -1);
    // Each part's audio is where the plan said it would be.
    const planned = plan?.segments.map((s) =>
      new URL(s.audioUrl).pathname.slice(1),
    );
    expect(planned?.toSorted()).toEqual(store.chunksAsked.toSorted());
    // How many were made as each was asked after: none, then one, then two
    // for a batch of four; never a part before those ahead of it.
    expect(made.slice(0, 7)).toEqual([0, 1, 2, 2, 2, 2, 6]);
    expect(job?.segmentCount).toBe(job?.plannedCount);
  });

  test("whose job was cancelled makes no more parts", async () => {
    store.beforeChunk = async () => {
      await db
        .update(schema.ttsJobs)
        .set({ status: "cancelled" })
        .where(eq(schema.ttsJobs.id, KEY));
    };

    await generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-1");

    expect(store.chunksAsked).toHaveLength(1);
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

    expect(store.chunksAsked).toHaveLength(1);
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

  test("with a part that can't be made ends in error, and the next run makes only that part", async () => {
    // The sixth part asked after is the one never made.
    let missing: string | undefined;
    store.madeBefore = (pathname) => {
      if (store.chunksAsked.length === 6) missing ??= pathname;
      return pathname !== missing;
    };
    store.speech = () => new Response(null, { status: 400 });

    await expect(
      generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-1"),
    ).rejects.toThrow("OpenAI TTS error: 400");

    const failed = await jobOf();
    expect(failed).toMatchObject({ status: "error" });
    expect(failed?.error).toContain("OpenAI TTS error: 400");

    store.paidFor.length = 0;
    store.speech = () => new Response(new Uint8Array([1, 2, 3]));
    await db
      .update(schema.ttsJobs)
      .set({ status: "queued", runId: "run-2", error: null })
      .where(eq(schema.ttsJobs.id, KEY));

    await generateDocumentTtsWorkflow(DOC, MARKDOWN, VOICE, "run-2");

    expect(store.paidFor).toHaveLength(1);
    expect(await jobOf()).toMatchObject({ status: "ready" });
  });
});
