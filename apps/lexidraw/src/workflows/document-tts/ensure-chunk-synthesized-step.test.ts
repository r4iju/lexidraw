/// <reference types="bun" />
import { afterAll, expect, test } from "bun:test";
import { fakeAudioStore } from "~/test/audio-store";
import { installServerRuntime } from "~/test/server-runtime";

await installServerRuntime();
const { default: env } = await import("@packages/env");
const MADE = "made-before";
const store = fakeAudioStore({
  madeBefore: (pathname) => pathname.includes(MADE),
});
afterAll(store.restore);
const { ensureChunkSynthesizedStep } = await import(
  "./ensure-chunk-synthesized-step"
);

test("a chunk made before is reused without paying for it again", async () => {
  const made = await ensureChunkSynthesizedStep({
    index: 0,
    text: "Said before.",
    normalizedText: "Said before.",
    chunkHash: MADE,
    provider: "openai",
    voiceId: "alloy",
    speed: 1,
    format: "mp3",
  });

  expect(store.paidFor).toEqual([]);
  expect(made.audioUrl).toBe(
    `${env.VERCEL_BLOB_STORAGE_HOST}/tts/chunks/${MADE}.mp3`,
  );
});
