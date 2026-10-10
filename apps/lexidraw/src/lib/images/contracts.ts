import { z } from "zod";

import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PROMPT_BYTES,
  imagePromptBytes,
  validatePng,
} from "./format";
export { IMAGE_MAX_BYTES, IMAGE_MAX_PROMPT_BYTES } from "./format";
export const IMAGE_UNAVAILABLE =
  "Image generation is unavailable: account access, exact parameters, complete cost bounds and direct transport have not been verified.";
export const ImageInput = z
  .strictObject({
    idempotencyKey: z.string().min(1).max(100),
    prompt: z.string().min(1).max(1500),
    acceptedMaximum: z.number().int().nonnegative(),
  })
  .refine(
    (x) => imagePromptBytes(x.prompt) <= IMAGE_MAX_PROMPT_BYTES,
    "Image exceeds bounded prompt",
  );
export const ImageUsage = z
  .strictObject({
    inputTokens: z.number().int().min(0).max(2000),
    thinkingTokens: z.number().int().min(0).max(44000),
    textOutputTokens: z.number().int().min(0).max(44000),
    outputImages: z.literal(1),
  })
  .refine((x) => x.thinkingTokens + x.textOutputTokens <= 44000);
export const ImagePricebook = z
  .strictObject({
    modality: z.literal("image"),
    version: z.string(),
    provider: z.string(),
    model: z.string(),
    fixture: z.literal(true),
    width: z.literal(1024),
    height: z.literal(1024),
    count: z.literal(1),
    quality: z.literal("fixture"),
    inputTokenNanoUsd: z.number().int().nonnegative(),
    outputTokenNanoUsd: z.number().int().nonnegative(),
    outputImageNanoUsd: z.number().int().nonnegative(),
    creditNanoUsd: z.number().int().positive(),
    maximumNanoUsd: z.number().int().positive(),
    quote: z.number().int().positive(),
    maxAttempts: z.literal(1),
    maxElapsedMs: z.literal(30000),
  })
  .refine(
    (p) =>
      Number.isSafeInteger(p.maximumNanoUsd * 1_000_000) &&
      2000 * p.inputTokenNanoUsd +
        44000 * p.outputTokenNanoUsd +
        p.outputImageNanoUsd <=
        p.maximumNanoUsd &&
      p.quote === Math.ceil((p.maximumNanoUsd * 1_000_000) / p.creditNanoUsd),
    "Incomplete image price bound",
  );
// Synthetic reference rates exercise the contract. They do not certify any provider or the preliminary Gemini quote.
export const IMAGE_FIXTURE_PRICEBOOK = ImagePricebook.parse({
  modality: "image",
  version: "image-fixture-v1",
  provider: "injected",
  model: "deterministic-image-fixture",
  fixture: true,
  width: 1024,
  height: 1024,
  count: 1,
  quality: "fixture",
  inputTokenNanoUsd: 1000,
  outputTokenNanoUsd: 1000,
  outputImageNanoUsd: 134_000_000,
  creditNanoUsd: 3_000_000,
  maximumNanoUsd: 180_000_000,
  quote: 60_000_000,
  maxAttempts: 1,
  maxElapsedMs: 30000,
});
export function imageCharge(usage: unknown, snapshot: unknown) {
  const u = ImageUsage.parse(usage),
    p = ImagePricebook.parse(snapshot);
  const cost =
    u.inputTokens * p.inputTokenNanoUsd +
    (u.thinkingTokens + u.textOutputTokens) * p.outputTokenNanoUsd +
    u.outputImages * p.outputImageNanoUsd;
  if (cost > p.maximumNanoUsd) throw new Error("Image cost exceeds quote");
  return Math.ceil((cost * 1_000_000) / p.creditNanoUsd);
}
export const ImageArtifact = z.strictObject({
  mimeType: z.literal("image/png"),
  width: z.literal(1024),
  height: z.literal(1024),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil(IMAGE_MAX_BYTES / 3) * 4),
});
export type ImageArtifact = z.infer<typeof ImageArtifact>;
export { crc32 } from "./format";
export function validateImage(
  value: unknown,
  assertSafe: (text: string) => void = () => {},
) {
  const image = ImageArtifact.parse(value);
  return { image, bytes: validatePng(image.base64, assertSafe) };
}
export const ImageCompletion = z.strictObject({
  kind: z.literal("image"),
  image: ImageArtifact,
  usage: ImageUsage,
  actualCostNanoUsd: z.number().int().min(0).max(180_000_000),
});
export type ImageCompletion = z.infer<typeof ImageCompletion>;
