import { z } from "zod";
// Reference rates already include Google's published January 2027 increase.
export const NARRATION_BOOK_V1 = {
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
// Retain the original book for deterministic legacy-period mapping.
export const NARRATION_BOOK = NARRATION_BOOK_V1;
export const NarrationBook = z
  .strictObject({
    version: z.string().min(1),
    provider: z.literal("google"),
    model: z.string().min(1),
    voice: z.string().min(1),
    style: z.string(),
    inputNanoUsd: z.number().int().nonnegative().max(1_000_000),
    audioNanoUsd: z.number().int().nonnegative().max(1_000_000),
    creditNanoUsd: z.number().int().positive(),
    maxChunkInputTokens: z.literal(2850),
    maxChunkAudioTokens: z.literal(3000),
    maxChunkSeconds: z.literal(120),
    maxChunks: z.literal(8),
    maxDocumentBytes: z.literal(6000),
    maxElapsedMs: z.literal(1_200_000),
    maxAttempts: z.literal(8),
    maxRetries: z.literal(2),
    schedule: z.array(
      z.strictObject({
        from: z.string(),
        inputNanoUsd: z.number().int().nonnegative(),
        audioNanoUsd: z.number().int().nonnegative(),
      }),
    ),
  })
  .refine(
    (b) => Number.isSafeInteger(narrationMaximum(b) * b.maxChunks),
    "Unsafe credit bound",
  );
export type NarrationBook = z.infer<typeof NarrationBook>;
export function narrationMaximum(book: {
  inputNanoUsd: number;
  audioNanoUsd: number;
  creditNanoUsd: number;
}) {
  return Math.ceil(
    ((2850 * book.inputNanoUsd + 3000 * book.audioNanoUsd) * 1_000_000) /
      book.creditNanoUsd,
  );
}
export const NARRATION_UNAVAILABLE =
  "Pro narration is Coming soon. Provider account access and an enforceable audio output bound have not been verified. Saved recordings remain free to play.";
export const NARRATION_POLICY =
  "Private trial: accept the maximum for only the missing audio. Technical job failures return all reserved credits, including when parts were made. Confirmed parts are retained for retry without another generation charge. Cancel stops future parts; a fully completed recording is charged, otherwise confirmed cancellation is released. A disconnected or uncertain provider request stays reserved until owner reconciliation. Saved replay is free after credits expire or run out.";
export const NarrationUsage = z.strictObject({
  input: z.number().int().min(0).max(2850),
  audio: z.number().int().min(0).max(3000),
});
export const NARRATION_MAX_ATTEMPT_NANO_USD = 38_850_000;
export const NarrationPart = z.strictObject({
  kind: z.literal("narration_part"),
  audio: z.string().min(1).max(7_680_060),
  usage: NarrationUsage,
  actualCostNanoUsd: z
    .number()
    .int()
    .nonnegative()
    .max(NARRATION_MAX_ATTEMPT_NANO_USD),
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
    book: NarrationBook,
    quote: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    documentId: z.string().min(1).max(100),
    periodId: z.string().min(1),
    plan: NarrationPlan,
  })
  .refine(
    (x) =>
      x.quote ===
      new Set(x.plan.filter((p) => !p.cachedAttempt).map((p) => p.hash)).size *
        narrationMaximum(x.book),
  );
export const NarrationRequest = z.strictObject({
  documentId: z.string().min(1).max(100),
});
export const NarrationGenerate = NarrationRequest.extend({
  idempotencyKey: z.string().min(1).max(100),
  acceptedRevision: z.string().length(64),
  acceptedPeriod: z.string().nullable(),
  acceptedMaximum: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
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
