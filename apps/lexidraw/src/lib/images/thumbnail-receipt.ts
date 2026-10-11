import { z } from "zod";
const ImageURL = z.union([
  z.url(),
  z.string().regex(/^\/api\/generated-images\/[0-9a-f-]{36}$/),
]);
export const ThumbnailSnapshot = z.strictObject({
  light: z.string(),
  dark: z.string(),
  revision: z.number().int().nonnegative().nullable(),
});
export type ThumbnailSnapshot = z.infer<typeof ThumbnailSnapshot>;
export const GeneratedThumbnailInput = z.strictObject({
  entityId: z.string().min(1).max(100),
  uploadId: z.uuid(),
  expected: ThumbnailSnapshot,
});
export const ThumbnailReceipt = z.strictObject({
  kind: z.literal("saved"),
  purpose: z.literal("generated-thumbnail"),
  entityId: z.string().min(1).max(100),
  uploadId: z.uuid(),
  light: ImageURL,
  dark: ImageURL,
  revision: z.number().int().positive(),
});
export type ThumbnailReceipt = z.infer<typeof ThumbnailReceipt>;
