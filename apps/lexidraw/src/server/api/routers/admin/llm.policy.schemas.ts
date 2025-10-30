import { z } from "zod";

export const LLMModeSchema = z.enum(["chat", "agent", "autocomplete"]);

export const AllowedModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});

export const EnforcedCapsSchema = z.object({
  maxOutputTokensByProvider: z.object({
    openai: z.number().int().positive(),
    google: z.number().int().positive(),
  }),
});

export const LLMPolicySchema = z.object({
  mode: LLMModeSchema,
  provider: z.string().min(1),
  modelId: z.string().min(1),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().positive(),
  allowedModels: z.array(AllowedModelSchema),
  enforcedCaps: EnforcedCapsSchema,
  extraConfig: z.record(z.string(), z.unknown()).nullish(),
});

export const UpsertPolicyInputSchema = LLMPolicySchema;

export const PoliciesGetAllOutputSchema = z.array(
  LLMPolicySchema.extend({ id: z.number().int().positive() }).strict(),
);

export type LLMMode = z.infer<typeof LLMModeSchema>;
export type LLMPolicy = z.infer<typeof LLMPolicySchema>;
