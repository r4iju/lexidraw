import { z } from "zod";
import type { schema } from "@packages/drizzle";

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

// Read from the table, not the router's outputs: the router computes it.
export type AccountIdentity = Pick<
  typeof schema.users.$inferSelect,
  "email" | "name"
>;

/**
 * What someone types to confirm deleting their account: its email, or its
 * name when it has none. Settings and the procedure both read it from here.
 */
export function deletionConfirmation(user: AccountIdentity): string {
  return user.email ?? user.name;
}

export function confirmsDeletion(
  user: AccountIdentity,
  typed: string,
): boolean {
  const expected = deletionConfirmation(user).trim().toLowerCase();
  return expected !== "" && typed.trim().toLowerCase() === expected;
}

/** The read-aloud settings a new account starts with. */
export const TTS_DEFAULTS = {
  provider: "openai",
  voiceId: "alloy",
  speed: 1,
  format: "mp3",
  languageCode: "en-US",
} as const;

type TtsProvider = (typeof TTS_PROVIDERS)[number];
type TtsSettings = {
  provider: TtsProvider;
  voiceId: string;
  speed: number;
  format: "mp3" | "ogg" | "wav";
  languageCode: string;
  sampleRate?: number;
};

const isProvider = (value: unknown): value is TtsProvider =>
  (TTS_PROVIDERS as readonly unknown[]).includes(value);

/**
 * What an account's saved read-aloud settings still say. A service the app
 * no longer has (macOS `say`, XTTS) counts as unsaved, and so does the voice
 * saved with it, which only that service had.
 */
export function savedTts(stored: unknown): Partial<TtsSettings> {
  const saved = (stored ?? {}) as Record<string, unknown>;
  const gone = saved.provider !== undefined && !isProvider(saved.provider);
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  const number = (value: unknown) =>
    typeof value === "number" ? value : undefined;
  const format = ["mp3", "ogg", "wav"].includes(saved.format as string)
    ? (saved.format as TtsSettings["format"])
    : undefined;
  const settings: Partial<TtsSettings> = {
    provider: isProvider(saved.provider) ? saved.provider : undefined,
    voiceId: gone ? undefined : text(saved.voiceId),
    speed: number(saved.speed),
    format,
    languageCode: text(saved.languageCode),
    sampleRate: number(saved.sampleRate),
  };
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== undefined),
  );
}

/** The voice a service reads in when none is chosen. */
export function defaultVoice(provider: string, languageCode?: string): string {
  if (provider === "google") return "en-US-Standard-C";
  if (provider === "kokoro")
    return (languageCode ?? "").toLowerCase().startsWith("ja")
      ? "jf_alpha"
      : "af_heart";
  return TTS_DEFAULTS.voiceId;
}

/**
 * The voice an account reads in, and the one its settings show: what it
 * saved, over the defaults a new account starts with, and for a service
 * chosen without a voice, that service's own default voice.
 */
export function listenSettings(stored: unknown): TtsSettings {
  const saved = savedTts(stored);
  const settings = { ...TTS_DEFAULTS, ...saved };
  return {
    ...settings,
    voiceId:
      saved.voiceId ?? defaultVoice(settings.provider, settings.languageCode),
  };
}
