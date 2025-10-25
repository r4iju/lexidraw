import { z } from "zod";

// Define a reusable schema for the LLM base configuration
const LlmBaseConfigSchema = z.object({
  modelId: z.string(),
  provider: z.string(),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().positive(),
});

export const ProfileSchema = z.object({
  name: z.string().min(1).default(""),
  email: z.string().min(1).email().default(""),
  googleApiKey: z.string().min(0).optional(),
  openaiApiKey: z.string().min(0).optional(),
  // Add nested, optional config objects
  chat: LlmBaseConfigSchema.optional(),
  autocomplete: LlmBaseConfigSchema.optional(),
  // Optional TTS and Article sections to allow unified profile update later
  tts: z
    .object({
      provider: z.enum(["openai", "google", "kokoro"]).optional(),
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
