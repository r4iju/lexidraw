import { z } from "zod";

// Define a reusable schema for the LLM base configuration (partial for overrides)
const LlmBaseConfigSchema = z.object({
  modelId: z.string().optional(),
  provider: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

// Autocomplete schema includes extra fields
const AutocompleteConfigSchema = LlmBaseConfigSchema.extend({
  reasoningEffort: z.enum(["minimal", "standard", "heavy"]).optional(),
  verbosity: z.enum(["low", "medium", "high"]).optional(),
});

export const ProfileSchema = z.object({
  name: z.string().min(1).default(""),
  email: z.string().min(1).email().default(""),
  autoSave: z.boolean().optional(),
  // Add nested, optional config objects for LLM overrides
  chat: LlmBaseConfigSchema.optional(),
  agent: LlmBaseConfigSchema.optional(),
  autocomplete: AutocompleteConfigSchema.optional(),
  // Optional TTS and Article sections to allow unified profile update later
  tts: z
    .object({
      provider: z
        .enum(["openai", "google", "kokoro", "apple_say", "xtts"])
        .optional(),
      voiceId: z.string().optional(),
      speed: z.number().min(0.25).max(4).optional(),
      format: z.enum(["mp3", "ogg", "wav"]).optional(),
      languageCode: z.string().optional(),
      sampleRate: z.number().int().positive().optional(),
    })
    .optional(),
  articles: z
    .object({
      languageCode: z.string().optional(),
      maxChars: z.number().int().positive().optional(),
      keepQuotes: z.boolean().optional(),
      autoGenerateAudioOnImport: z.boolean().optional(),
    })
    .optional(),
});

export type ProfileSchema = z.infer<typeof ProfileSchema>;
