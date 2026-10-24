import "server-only";
import { z } from "zod";
import { NarrationBook, NarrationPart } from "~/lib/narration/contracts";
import { pcmWav } from "~/lib/narration/portable";
import type { NarrationOutcome, NarrationTransport } from "./narration";
import { safeCost, SupplierContract } from "./supplier-contract";

const Wire = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(
              z.object({
                inlineData: z
                  .object({ mimeType: z.string(), data: z.string() })
                  .optional(),
              }),
            ),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .min(1),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative(),
    candidatesTokenCount: z.number().int().nonnegative().optional(),
    candidatesTokensDetails: z
      .array(
        z.object({
          modality: z.string(),
          tokenCount: z.number().int().nonnegative(),
        }),
      )
      .optional(),
  }),
  responseId: z.string().max(200).optional(),
});

/** Bills at the provider rate in force today; credits still settle at the operation's own snapshot. */
function providerCost(
  book: NarrationBook,
  input: number,
  audio: number,
  now: number,
) {
  const today = new Date(now).toISOString().slice(0, 10);
  const rate = book.schedule.filter((s) => s.from <= today).at(-1) ?? book;
  return safeCost(input * rate.inputNanoUsd, audio * rate.audioNanoUsd);
}

/** The PCM payload of a 24 kHz mono 16-bit WAV. Gemini appends a C2PA chunk after the data, which is dropped. */
function wavPcm(bytes: Buffer) {
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Not a WAV");
  let format: Buffer | undefined;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + size);
    if (body.length !== size) throw new Error("Truncated WAV chunk");
    if (id === "fmt ") format = body;
    if (id === "data") {
      if (
        format?.readUInt16LE(0) !== 1 ||
        format.readUInt16LE(2) !== 1 ||
        format.readUInt32LE(4) !== 24000 ||
        format.readUInt16LE(14) !== 16
      )
        throw new Error("Unexpected audio format");
      return body;
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error("WAV without audio");
}

function audioPcm(mimeType: string, bytes: Buffer) {
  const mime = mimeType.toLowerCase().replaceAll(" ", "");
  if (mime === "audio/wav" || mime === "audio/x-wav") return wavPcm(bytes);
  if (mime.startsWith("audio/l16;") && mime.includes("rate=24000"))
    return bytes;
  throw new Error("Unexpected audio type");
}

export function createGeminiNarrationTransport(deps: {
  authorize: (
    context: Parameters<NarrationTransport>[2],
  ) => Promise<SupplierContract>;
  resolveKey: () => string | undefined;
  fetch: (request: Request) => Promise<Response>;
  now?: () => number;
}): NarrationTransport {
  const now = deps.now ?? Date.now;
  return async (text, signal, context): Promise<NarrationOutcome> => {
    let book: NarrationBook;
    try {
      const contract = SupplierContract.parse(await deps.authorize(context));
      if (contract.feature !== "narration")
        throw new Error("Supplier feature mismatch");
      book = NarrationBook.parse(contract.book);
    } catch {
      return { kind: "failed", actualCostNanoUsd: 0 };
    }
    const key = deps.resolveKey();
    if (!key) return { kind: "failed", actualCostNanoUsd: 0 };
    // Network errors and aborts propagate: the request may have been billed, so the attempt becomes unknown.
    const response = await deps.fetch(
      new Request(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(book.model)}:generateContent`,
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Read the following text faithfully with ${book.style}:\n\n${text}`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              maxOutputTokens: book.maxChunkAudioTokens,
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: book.voice } },
              },
            },
          }),
        },
      ),
    );
    // Rejected requests produce no output and are not billed.
    if (!response.ok) return { kind: "failed", actualCostNanoUsd: 0 };
    const wire = Wire.safeParse(await response.json());
    if (!wire.success) return { kind: "unknown" };
    const usage = wire.data.usageMetadata;
    const audioTokens =
      usage.candidatesTokensDetails?.find((d) => d.modality === "AUDIO")
        ?.tokenCount ??
      usage.candidatesTokenCount ??
      0;
    if (
      usage.promptTokenCount > book.maxChunkInputTokens ||
      audioTokens > book.maxChunkAudioTokens
    )
      return { kind: "unknown" };
    const actualCostNanoUsd = providerCost(
      book,
      usage.promptTokenCount,
      audioTokens,
      now(),
    );
    const candidate = wire.data.candidates[0];
    if (!candidate) return { kind: "failed", actualCostNanoUsd };
    const inline = candidate.content?.parts.find(
      (p) => p.inlineData,
    )?.inlineData;
    if (candidate.finishReason !== "STOP" || !inline)
      return { kind: "failed", actualCostNanoUsd };
    try {
      const wav = Buffer.from(
        pcmWav(audioPcm(inline.mimeType, Buffer.from(inline.data, "base64"))),
      );
      const seconds = (wav.length - 44) / 48000;
      if (audioTokens < Math.ceil(seconds * 25))
        throw new Error("Audio usage does not cover duration");
      return {
        kind: "completed",
        completion: NarrationPart.parse({
          kind: "narration_part",
          audio: wav.toString("base64"),
          usage: { input: usage.promptTokenCount, audio: audioTokens },
          actualCostNanoUsd,
          providerResponseId: wire.data.responseId,
        }),
      };
    } catch {
      return { kind: "failed", actualCostNanoUsd };
    }
  };
}
