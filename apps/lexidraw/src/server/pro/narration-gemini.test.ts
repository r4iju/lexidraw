import { makeSupplierContract } from "./supplier-contract";
import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
import { NARRATION_BOOK } from "~/lib/narration/contracts";
import { validateWav } from "~/lib/narration/portable";
import { audioSeconds } from "./narration-audio";
const { createGeminiNarrationTransport } = await import("./narration-gemini");

const contract = makeSupplierContract(
  "narration",
  NARRATION_BOOK,
  "verified-server",
);
const context = {
  operationId: "op",
  attemptId: "attempt",
  chunkHash: "a".repeat(64),
  periodId: "period",
  accountId: "account",
  supplier: contract,
};

// Shape observed from gemini-3.8-flash-lite-tts on 2026-10-24: canonical PCM
// followed by a C2PA provenance chunk.
function geminiWav(pcmBytes: number, rate = 24000, channels = 1) {
  const pcm = Buffer.alloc(pcmBytes, 7);
  const c2pa = Buffer.concat([
    Buffer.from("C2PA"),
    Buffer.alloc(4),
    Buffer.from("jumb"),
  ]);
  c2pa.writeUInt32LE(4, 4);
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length + c2pa.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2 * channels, 28);
  header.writeUInt16LE(2 * channels, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return { pcm, wav: Buffer.concat([header, pcm, c2pa]) };
}

function response(
  wav: Buffer,
  usage: { input: number; audio: number },
  finishReason = "STOP",
) {
  return Response.json({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: wav.toString("base64"),
              },
            },
          ],
        },
        finishReason,
      },
    ],
    usageMetadata: {
      promptTokenCount: usage.input,
      candidatesTokenCount: usage.audio,
      candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: usage.audio }],
    },
    responseId: "gemini-response",
  });
}

test("Gemini narration sends the capped reference request and stores canonical PCM WAV", async () => {
  const { pcm, wav } = geminiWav(48000 * 4);
  let sent: Request | undefined;
  const transport = createGeminiNarrationTransport({
    authorize: async () => contract,
    resolveKey: () => "fake-google-key",
    fetch: async (request) => {
      sent = request;
      return response(wav, { input: 115, audio: 100 });
    },
    now: () => Date.parse("2026-10-24T00:00:00Z"),
  });
  const outcome = await transport(
    "Hello there.",
    new AbortController().signal,
    context,
  );

  if (!sent) throw new Error("No provider request");
  expect(sent.url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent",
  );
  expect(sent.headers.get("x-goog-api-key")).toBe("fake-google-key");
  const body = await sent.json();
  expect(body.contents[0].parts[0].text).toContain("Hello there.");
  expect(body.generationConfig).toEqual({
    responseModalities: ["AUDIO"],
    maxOutputTokens: 3000,
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
    },
  });

  if (outcome.kind !== "completed")
    throw new Error(`Unexpected ${outcome.kind}`);
  const { bytes } = validateWav(outcome.completion.audio);
  expect(Buffer.from(bytes.subarray(44)).equals(pcm)).toBe(true);
  expect(audioSeconds(outcome.completion)).toBe(4);
  expect(outcome.completion.usage).toEqual({ input: 115, audio: 100 });
  // Provider cost follows the schedule in force, not the higher quoted rate.
  expect(outcome.completion.actualCostNanoUsd).toBe(115 * 500 + 100 * 6000);
  expect(outcome.completion.providerResponseId).toBe("gemini-response");
});

test("Gemini narration fails a capped or malformed response with its billed cost", async () => {
  const capped = createGeminiNarrationTransport({
    authorize: async () => contract,
    resolveKey: () => "fake-google-key",
    fetch: async () =>
      response(
        geminiWav(48000 * 4).wav,
        { input: 115, audio: 100 },
        "MAX_TOKENS",
      ),
    now: () => Date.parse("2026-10-24T00:00:00Z"),
  });
  expect(await capped("Hello", new AbortController().signal, context)).toEqual({
    kind: "failed",
    actualCostNanoUsd: 115 * 500 + 100 * 6000,
  });

  const wrongRate = createGeminiNarrationTransport({
    authorize: async () => contract,
    resolveKey: () => "fake-google-key",
    fetch: async () =>
      response(geminiWav(44100 * 2 * 2, 44100).wav, { input: 115, audio: 50 }),
    now: () => Date.parse("2026-10-24T00:00:00Z"),
  });
  expect(
    await wrongRate("Hello", new AbortController().signal, context),
  ).toEqual({
    kind: "failed",
    actualCostNanoUsd: 115 * 500 + 50 * 6000,
  });
});

test("Gemini narration never dispatches without authorization and a key", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return response(geminiWav(48000).wav, { input: 10, audio: 25 });
  };
  const denied = createGeminiNarrationTransport({
    authorize: async () => {
      throw new Error("Paid steps stopped");
    },
    resolveKey: () => "fake-google-key",
    fetch,
  });
  const keyless = createGeminiNarrationTransport({
    authorize: async () => contract,
    resolveKey: () => undefined,
    fetch,
  });
  for (const transport of [denied, keyless])
    expect(
      await transport("Hello", new AbortController().signal, context),
    ).toEqual({
      kind: "failed",
      actualCostNanoUsd: 0,
    });
  expect(calls).toBe(0);
});
