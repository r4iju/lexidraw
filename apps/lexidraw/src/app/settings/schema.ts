import { z } from "zod";

/**
 * What Settings saves. Every override is nullable: null means "follow the
 * default again", so a field someone cleared stops pinning an old value.
 */
const LlmOverride = z
  .object({
    provider: z.string().nullable(),
    modelId: z.string().nullable(),
    temperature: z.number().min(0).max(1).nullable(),
    maxOutputTokens: z.number().int().positive().nullable(),
  })
  .partial();

const AutocompleteOverride = LlmOverride.extend({
  enabled: z.boolean().nullable(),
  reasoningEffort: z.enum(["minimal", "standard", "heavy"]).nullable(),
  verbosity: z.enum(["low", "medium", "high"]).nullable(),
}).partial();

export const TTS_PROVIDERS = ["openai", "google", "kokoro"] as const;

const TtsOverride = z
  .object({
    provider: z.enum(TTS_PROVIDERS).nullable(),
    voiceId: z.string().nullable(),
    speed: z.number().min(0.25).max(4).nullable(),
    languageCode: z.string().nullable(),
  })
  .partial();

export const SettingsSchema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter your email address."),
  autoSave: z.boolean().optional(),
  chat: LlmOverride.optional(),
  agent: LlmOverride.optional(),
  autocomplete: AutocompleteOverride.optional(),
  tts: TtsOverride.optional(),
});

export type SettingsInput = z.infer<typeof SettingsSchema>;

/** The read-aloud settings a new account starts with. */
export const TTS_DEFAULTS = {
  provider: "openai",
  voiceId: "alloy",
  speed: 1,
  format: "mp3",
  languageCode: "en-US",
} as const;
