import { z } from "zod";

// Define a reusable schema for the LLM base configuration
const LlmBaseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  modelId: z.string(),
  provider: z.string(),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().positive(),
});

export const ProfileSchema = z.object({
  name: z.string().min(1).default(""),
  email: z.string().min(1).email().default(""),
  googleApiKey: z.string().min(0).optional(),
  openaiApiKey: z.string().min(0).optional(),
  // Add nested, optional config objects
  chat: LlmBaseConfigSchema.optional(),
  autocomplete: LlmBaseConfigSchema.optional(),
});

export type ProfileSchema = z.infer<typeof ProfileSchema>;
