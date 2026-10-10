import { z } from "zod";

export const SUBCREDITS = 1_000_000;
export const PRICEBOOK = {
  version: "private-text-2026-10-v1",
  monthlyUsd: 12,
  monthlyCredits: 1000,
  creditNanoUsd: 3_000_000,
  provider: "openai",
  model: "gpt-5.4-mini",
  inputNanoUsd: 750,
  cachedInputNanoUsd: 75,
  outputNanoUsd: 4500,
  maxInputTokens: 4096,
  maxOutputTokens: 512,
  maxInputBytes: 1500,
  maxAttempts: 2,
  maxElapsedMs: 30_000,
  maxConcurrent: 2,
  maxRequestsPerMinute: 10,
  accountSpendNanoUsd: 4_000_000_000,
  accountFailureSpendNanoUsd: 1_000_000_000,
  globalDailySpendNanoUsd: 10_000_000_000,
} as const;
export const MAX_ATTEMPT_NANO_USD = 5_376_000;
export const TEXT_QUOTE = 1_792_000;
export const TRIAL_POLICY: { version: string; disclosure: string } = {
  version: "private-cancellation-v1",
  disclosure:
    "Private trial: $12/month and 1,000 credits are test values, not a live purchase. Text reserves at most 1.792 credits; an opt-in writing suggestion reserves at most 1.120 credits and usage is shown in aggregate. Final charges use measured input and output (including reasoning); internal retries are our cost. Technical failures return the reservation. Cancel stops new paid steps. Completed results are charged even after cancellation or disconnect; confirmed cancellation without completion is released. Uncertain provider outcomes remain reserved for owner reconciliation. Credits expire at renewal, with no rollover or top-ups. Public cancellation terms are undecided before launch.",
} as const;
export const TextInput = z.strictObject({
  idempotencyKey: z.string().min(1).max(100),
  text: z.string().min(1).max(3000),
});
export const Usage = z
  .strictObject({
    input: z.number().int().min(0).max(4096),
    cachedInput: z.number().int().min(0).max(4096),
    output: z.number().int().min(0).max(512),
  })
  .refine((x) => x.cachedInput <= x.input);
export type Usage = z.infer<typeof Usage>;
export const Completion = z.strictObject({
  text: z.string().min(1).max(16000),
  providerResponseId: z.string().max(200).optional(),
  usage: Usage,
  actualCostNanoUsd: z.number().int().nonnegative().max(MAX_ATTEMPT_NANO_USD),
});
export type Completion = z.infer<typeof Completion>;
const ReferenceRates = z.object({
  inputNanoUsd: z.number().int().nonnegative(),
  cachedInputNanoUsd: z.number().int().nonnegative(),
  outputNanoUsd: z.number().int().nonnegative(),
  creditNanoUsd: z.number().int().positive(),
});
export function referenceCharge(usage: Usage, snapshot: unknown = PRICEBOOK) {
  const rates = ReferenceRates.parse(snapshot);
  const parsed = Usage.parse(usage);
  return Math.ceil(
    (((parsed.input - parsed.cachedInput) * rates.inputNanoUsd +
      parsed.cachedInput * rates.cachedInputNanoUsd +
      parsed.output * rates.outputNanoUsd) *
      SUBCREDITS) /
      rates.creditNanoUsd,
  );
}
export const Operation = z.object({
  id: z.string(),
  account_id: z.string(),
  period_id: z.string(),
  idempotency_key: z.string(),
  input_hash: z.string(),
  feature: z.string(),
  state: z.enum([
    "reserved",
    "running",
    "unknown",
    "settled",
    "refunded",
    "cancelled",
  ]),
  quote: z.number().int(),
  charged: z.number().int(),
  pricebook: z.string(),
  policy: z.string(),
  result: z.string().nullable(),
  cancel_requested: z.number(),
  created_at: z.number(),
});
export type Operation = z.infer<typeof Operation>;

export const AUTOCOMPLETE_QUOTE = 1_120_000;
export const AutocompleteInput = z.strictObject({
  idempotencyKey: z.string().min(1).max(100),
  title: z.string().max(200),
  before: z.string().min(1).max(1200),
  after: z.string().max(300),
});
