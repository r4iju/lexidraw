import { z } from "zod";
// Reference rates already include Google's published January 2027 increase.
export const NARRATION_BOOK = {
  version: "private-narration-2026-10-v1",
  provider: "google",
  model: "gemini-3.8-flash-lite-tts",
  voice: "Kore",
  style: "clear, natural narration",
  inputNanoUsd: 1000,
  audioNanoUsd: 12000,
  creditNanoUsd: 3_000_000,
  maxChunkInputTokens: 2850,
  maxChunkAudioTokens: 3000,
  maxChunkSeconds: 120,
  maxChunks: 8,
  maxDocumentBytes: 6000,
  maxElapsedMs: 1_200_000,
  maxAttempts: 8,
  maxRetries: 2,
  schedule: [
    { from: "2026-10-10", inputNanoUsd: 500, audioNanoUsd: 6000 },
    { from: "2027-01-01", inputNanoUsd: 1000, audioNanoUsd: 12000 },
  ],
} as const;
export const NARRATION_UNAVAILABLE =
  "Pro narration is Coming soon. Provider account access and an enforceable audio output bound have not been verified. Saved recordings remain free to play.";
export const NARRATION_POLICY =
  "Private trial: accept the maximum for only the missing audio. Technical job failures return all reserved credits, including when parts were made. Confirmed parts are retained for retry without another generation charge. Cancel stops future parts; a fully completed recording is charged, otherwise confirmed cancellation is released. A disconnected or uncertain provider request stays reserved until owner reconciliation. Saved replay is free after credits expire or run out.";
export const NarrationUsage = z.strictObject({
  input: z.number().int().min(0).max(2850),
  audio: z.number().int().min(0).max(3000),
});
export const NarrationPart = z.strictObject({
  kind: z.literal("narration_part"),
  audio: z.string().min(1).max(7_680_060),
  usage: NarrationUsage,
  actualCostNanoUsd: z.number().int().nonnegative().max(38_850_000),
  providerResponseId: z.string().max(200).optional(),
});
export type NarrationPart = z.infer<typeof NarrationPart>;
export function narrationCharge(
  usage: z.infer<typeof NarrationUsage>,
  snapshot: unknown = NARRATION_BOOK,
) {
  const rates = z
    .object({
      inputNanoUsd: z.number().int().nonnegative(),
      audioNanoUsd: z.number().int().nonnegative(),
      creditNanoUsd: z.number().int().positive(),
    })
    .parse(snapshot);
  const u = NarrationUsage.parse(usage);
  return Math.ceil(
    ((u.input * rates.inputNanoUsd + u.audio * rates.audioNanoUsd) *
      1_000_000) /
      rates.creditNanoUsd,
  );
}
export const CHUNK_MAXIMUM = 12_950_000;
export const NarrationPlan = z
  .array(
    z.strictObject({
      hash: z.string().length(64),
      text: z.string().min(1).max(1000),
      cachedAttempt: z.string().optional(),
    }),
  )
  .min(1)
  .max(8);
export type NarrationPlan = z.infer<typeof NarrationPlan>;
export const NarrationReservation = z
  .strictObject({
    book: z.custom<typeof NARRATION_BOOK>(
      (value) => JSON.stringify(value) === JSON.stringify(NARRATION_BOOK),
    ),
    quote: z
      .number()
      .int()
      .positive()
      .max(CHUNK_MAXIMUM * 8),
    documentId: z.string().min(1).max(100),
    periodId: z.string().min(1),
    plan: NarrationPlan,
  })
  .refine(
    (x) =>
      x.quote ===
      new Set(x.plan.filter((p) => !p.cachedAttempt).map((p) => p.hash)).size *
        CHUNK_MAXIMUM,
  );
export const NarrationRequest = z.strictObject({
  documentId: z.string().min(1).max(100),
});
export const NarrationGenerate = NarrationRequest.extend({
  idempotencyKey: z.string().min(1).max(100),
  acceptedRevision: z.string().length(64),
  acceptedPeriod: z.string().nullable(),
  acceptedMaximum: z
    .number()
    .int()
    .nonnegative()
    .max(CHUNK_MAXIMUM * 8),
});
export const NarrationSnapshot = z.object({
  id: z.string().nullable(),
  state: z.enum([
    "saved",
    "reserved",
    "running",
    "unknown",
    "settled",
    "refunded",
    "cancelled",
  ]),
  charged: z.number().int(),
  quote: z.number().int(),
  made: z.number().int(),
  planned: z.number().int(),
  parts: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      audio: z.string(),
      seconds: z.number(),
    }),
  ),
  policy: z.string(),
});
export type NarrationSnapshot = z.infer<typeof NarrationSnapshot>;
