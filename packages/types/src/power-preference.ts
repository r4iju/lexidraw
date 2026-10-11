import { z } from "zod";

export const PowerPreferenceSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("local") }),
  z.strictObject({ mode: z.literal("pro") }),
  z.strictObject({
    mode: z.literal("byok"),
    provider: z.literal("openrouter"),
  }),
]);
export type PowerPreference = z.infer<typeof PowerPreferenceSchema>;
