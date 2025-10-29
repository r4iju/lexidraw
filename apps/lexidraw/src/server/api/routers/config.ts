import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq } from "@packages/drizzle";
import env from "@packages/env";

export const LlmBaseConfigSchema = z.object({
  modelId: z.string(),
  provider: z.string(),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().positive(),
});

export const LlmConfigSchema = z.object({
  googleApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  chat: LlmBaseConfigSchema,
  autocomplete: LlmBaseConfigSchema,
  agent: LlmBaseConfigSchema,
});

export const PatchSchema = z.object({
  googleApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  chat: LlmBaseConfigSchema.partial().optional(),
  autocomplete: LlmBaseConfigSchema.partial().optional(),
  agent: LlmBaseConfigSchema.partial().optional(),
});

export type StoredLlmConfig = z.infer<typeof LlmConfigSchema>;
export type PartialLlmConfig = z.infer<typeof PatchSchema>;

// --- Shared TTS options result types (exported for client usage) ---
export type TtsVoice = { id: string; label: string; languageCodes: string[] };
export type TtsOptionsDiagnostics =
  | { code: "missing_api_key"; message?: string }
  | { code: "invalid_api_key"; message?: string }
  | { code: "http_error"; status?: number; message?: string };
export type TtsOptionsResult = {
  voices: TtsVoice[];
  languages: string[];
  diagnostics?: TtsOptionsDiagnostics;
};

// --- New unified TTS config shape for richer UI ---
export type TtsConfigProvider = {
  id: string;
  label: string;
  formats: string[];
  languages: string[];
  capabilities?: { ssml?: boolean; needsSpeakerWav?: boolean };
};
export type TtsConfigVoice = TtsVoice & {
  provider: string;
  family?: string;
  requires?: { speakerWav?: string };
};
export type TtsConfigResult = {
  providers: TtsConfigProvider[];
  languages: string[];
  families: string[];
  voices: TtsConfigVoice[];
  diagnostics?: TtsOptionsDiagnostics;
};

// --- Kokoro helpers ---
const KOKORO_FALLBACK: TtsOptionsResult = {
  voices: [
    {
      id: "af_heart",
      label: "Heart (Female)",
      languageCodes: ["en-US"],
    },
  ],
  languages: ["en-US"],
};

const KOKORO_LANG_FROM_PREFIX: Record<string, string> = {
  a: "en-US", // American English
  b: "en-GB", // British English
  // Other languages exist (j, z, e, f, h, i, p), but we currently scope to English
};
const KOKORO_GENDER_FROM_PREFIX: Record<string, "Female" | "Male"> = {
  f: "Female",
  m: "Male",
};

function formatKokoroLabel(id: string): string {
  // id like "af_heart" → "Heart (Female)"
  const parts = id.split("_");
  const suffix = parts.slice(1).join("_") || id; // voice name
  const name = suffix.charAt(0).toUpperCase() + suffix.slice(1);
  const genderKey = id.length > 1 ? id[1] : "";
  const gender = KOKORO_GENDER_FROM_PREFIX[genderKey || ""];
  return gender ? `${name} (${gender})` : name;
}

// Define separate defaults
const defaultChatBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  modelId: "gemini-2.5-flash",
  provider: "google",
  temperature: 0.7,
  maxOutputTokens: 100000,
};

const defaultAutocompleteBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  modelId: "gemini-2.5-flash-lite",
  provider: "google",
  temperature: 0.3,
  maxOutputTokens: 500,
};

const defaultAgentBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  // For now mirror chat defaults; can be tuned separately later
  modelId: "gemini-2.5-flash",
  provider: "google",
  temperature: 0.7,
  maxOutputTokens: 100000,
};

// --- Provider normalization helpers ---
const MAX_TOKENS_BY_PROVIDER: Record<string, number> = {
  openai: 32768,
  google: 65535,
};

function normalizeBaseConfig(
  base: z.infer<typeof LlmBaseConfigSchema>,
): z.infer<typeof LlmBaseConfigSchema> {
  const cap = MAX_TOKENS_BY_PROVIDER[base.provider] ?? base.maxOutputTokens;
  const maxOutputTokens = Math.min(base.maxOutputTokens, cap);
  // temperature already validated by zod min/max
  return { ...base, maxOutputTokens };
}

// --- TTS and Article Config Schemas & Defaults ---
const TtsConfigSchema = z.object({
  provider: z.enum(["openai", "google", "kokoro", "apple_say", "xtts"]),
  voiceId: z.string(),
  speed: z.number().min(0.25).max(4),
  format: z.enum(["mp3", "ogg", "wav"]),
  languageCode: z.string(),
  sampleRate: z.number().int().positive().optional(),
});
const TtsPatchSchema = TtsConfigSchema.partial();

const ArticleConfigSchema = z.object({
  languageCode: z.string(),
  maxChars: z.number().int().positive(),
  keepQuotes: z.boolean(),
  autoGenerateAudioOnImport: z.boolean(),
});
const ArticlePatchSchema = ArticleConfigSchema.partial();

const defaultTts: z.infer<typeof TtsConfigSchema> = {
  provider: "openai",
  voiceId: "alloy",
  speed: 1,
  format: "mp3",
  languageCode: "en-US",
};

const defaultArticles: z.infer<typeof ArticleConfigSchema> = {
  languageCode: "en-US",
  maxChars: 120000,
  keepQuotes: true,
  autoGenerateAudioOnImport: false,
};

export const configRouter = createTRPCRouter({
  // --- Autocomplete (separate, minimal engine) ---
  getAutocompleteConfig: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.drizzle.query.users.findFirst({
      where: eq(schema.users.id, ctx.session.user.id),
      columns: { config: true },
    });
    const defaults = {
      enabled: true,
      delayMs: 200,
      provider: "openai",
      modelId: "gpt-5-nano",
      temperature: 0.3,
      maxOutputTokens: 400,
      reasoningEffort: "minimal" as const,
      verbosity: "low" as const,
    };
    let cfg = (user?.config?.autocomplete ?? null) as
      | (typeof defaults & Record<string, unknown>)
      | null;

    // Migration: seed from old llm.autocomplete if missing
    if (!cfg) {
      const seed = user?.config?.llm?.autocomplete as
        | Partial<typeof defaults>
        | undefined;
      if (seed) {
        cfg = { ...defaults, ...seed } as typeof defaults & Record<string, unknown>;
        await ctx.drizzle
          .update(schema.users)
          .set({
            config: {
              ...(user?.config ?? {}),
              autocomplete: cfg,
            } as (typeof schema.users.$inferInsert)["config"],
          })
          .where(eq(schema.users.id, ctx.session.user.id));
      }
    }

    return { ...defaults, ...(cfg ?? {}) } as typeof defaults & Record<string, unknown>;
  }),
  updateAutocompleteConfig: protectedProcedure
    .input(
      z
        .object({
          enabled: z.boolean().optional(),
          delayMs: z.number().int().min(0).max(5000).optional(),
          provider: z.literal("openai").optional(),
          modelId: z.string().optional(),
          temperature: z.number().min(0).max(1).optional(),
          maxOutputTokens: z.number().int().positive().max(2000).optional(),
          reasoningEffort: z.enum(["minimal", "standard", "heavy"]).optional(),
          verbosity: z.enum(["low", "medium", "high"]).optional(),
        })
        .partial(),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: { config: true },
      });
      const next = {
        enabled: true,
        delayMs: 200,
        provider: "openai",
        modelId: "gpt-5-nano",
        temperature: 0.3,
        maxOutputTokens: 400,
        reasoningEffort: "minimal",
        verbosity: "low",
        ...(current?.config?.autocomplete ?? {}),
        ...input,
      } as Record<string, unknown>;
      await ctx.drizzle
        .update(schema.users)
        .set({ config: { ...(current?.config ?? {}), autocomplete: next } })
        .where(eq(schema.users.id, ctx.session.user.id));
      return next;
    }),
  getConfig: protectedProcedure.query(
    async ({ ctx }): Promise<StoredLlmConfig> => {
      const user = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: {
          config: true,
        },
      });

      const existingLlm = (user?.config?.llm ?? {}) as Partial<z.infer<typeof LlmConfigSchema>>;
      const llmConfigUnnormalized = {
        ...defaultChatBaseConfig,
        ...existingLlm,
        chat: {
          ...defaultChatBaseConfig,
          ...existingLlm?.chat,
        },
        autocomplete: {
          ...defaultAutocompleteBaseConfig,
          ...existingLlm?.autocomplete,
        },
        agent: {
          ...defaultAgentBaseConfig,
          ...existingLlm?.agent,
        },
      } satisfies StoredLlmConfig;

      const llmConfig: StoredLlmConfig = {
        ...llmConfigUnnormalized,
        chat: normalizeBaseConfig(llmConfigUnnormalized.chat),
        autocomplete: normalizeBaseConfig(llmConfigUnnormalized.autocomplete),
        agent: normalizeBaseConfig(llmConfigUnnormalized.agent),
      };

      return LlmConfigSchema.parse(llmConfig ?? {});
    },
  ),

  // --- Audio preferences ---
  getAudioConfig: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.drizzle.query.users.findFirst({
      where: eq(schema.users.id, ctx.session.user.id),
      columns: { config: true },
    });
    const preferredPlaybackRate =
      user?.config?.audio?.preferredPlaybackRate ?? 1;
    return { preferredPlaybackRate } as { preferredPlaybackRate: number };
  }),

  updateAudioConfig: protectedProcedure
    .input(
      z.object({
        preferredPlaybackRate: z.number().min(0.5).max(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: { config: true },
      });

      const nextConfig = {
        ...(current?.config ?? {}),
        audio: {
          ...(current?.config?.audio ?? {}),
          preferredPlaybackRate: input.preferredPlaybackRate,
        },
      } as (typeof schema.users.$inferInsert)["config"];

      await ctx.drizzle
        .update(schema.users)
        .set({
          config:
            nextConfig as unknown as (typeof schema.users.$inferInsert)["config"],
        })
        .where(eq(schema.users.id, ctx.session.user.id));

      return { preferredPlaybackRate: input.preferredPlaybackRate };
    }),

  // --- Read-only TTS options (voices/languages) ---
  getTtsOptions: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["openai", "google", "kokoro", "apple_say", "xtts"]),
      }),
    )
    .query(async ({ ctx, input }) => {
      type Voice = TtsVoice;
      type Result = TtsOptionsResult;

      // In-memory cache per user+provider for 10 minutes
      const now = Date.now();
      const cacheKey = `${ctx.session.user.id}:${input.provider}`;
      const g = globalThis as unknown as {
        __ttsOptionsCache?: Map<string, { expires: number; data: Result }>;
      };
      if (!g.__ttsOptionsCache) {
        g.__ttsOptionsCache = new Map<
          string,
          { expires: number; data: Result }
        >();
      }
      const bag = g.__ttsOptionsCache;
      const cached = bag.get(cacheKey);
      if (cached && cached.expires > now) return cached.data;

      if (input.provider === "openai") {
        const data: Result = {
          voices: [
            { id: "alloy", label: "alloy", languageCodes: ["en-US"] },
            { id: "aria", label: "aria", languageCodes: ["en-US"] },
            { id: "verse", label: "verse", languageCodes: ["en-US"] },
            { id: "sage", label: "sage", languageCodes: ["en-US"] },
            { id: "luna", label: "luna", languageCodes: ["en-US"] },
          ],
          languages: ["en-US"],
        };
        bag.set(cacheKey, { expires: now + 10 * 60_000, data });
        return data;
      }

      if (input.provider === "kokoro") {
        const baseUrl = env.KOKORO_URL?.replace(/\/$/, "");
        const bearer = env.KOKORO_BEARER;
        const dev = process.env.NODE_ENV !== "production";
        const successTtlMs = dev ? 5_000 : 10 * 60_000;
        const errorTtlMs = dev ? 5_000 : 60_000;
        // Fallback static voice if sidecar not configured
        if (!baseUrl) {
          bag.set(cacheKey, {
            expires: now + errorTtlMs,
            data: KOKORO_FALLBACK,
          });
          return KOKORO_FALLBACK;
        }
        try {
          const cfHeaders =
            process.env.NODE_ENV === "production" &&
            !!env.CF_ACCESS_CLIENT_ID &&
            !!env.CF_ACCESS_CLIENT_SECRET
              ? {
                  "CF-Access-Client-Id": process.env
                    .CF_ACCESS_CLIENT_ID as string,
                  "CF-Access-Client-Secret": process.env
                    .CF_ACCESS_CLIENT_SECRET as string,
                }
              : undefined;
          const resp = await fetch(`${baseUrl}/v1/voices`, {
            method: "GET",
            headers: {
              ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
              ...(cfHeaders ?? {}),
            },
          });
          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            const data: Result = {
              ...KOKORO_FALLBACK,
              diagnostics: {
                code: "http_error",
                status: resp.status,
                message: text,
              },
            };
            bag.set(cacheKey, { expires: now + errorTtlMs, data });
            return data;
          }
          const json = (await resp.json()) as { voices?: string[] };
          const ids = (Array.isArray(json.voices) ? json.voices : []).filter(
            (id) => {
              // Filter to English only (en-US/en-GB) via first-letter prefix
              const langKey = id?.[0];
              return langKey === "a" || langKey === "b";
            },
          );
          const voices: Voice[] = ids.map((id) => {
            const langKey = id.length > 0 ? id[0] : "a";
            const lang =
              KOKORO_LANG_FROM_PREFIX[
                langKey as keyof typeof KOKORO_LANG_FROM_PREFIX
              ] || "en-US";
            return { id, label: formatKokoroLabel(id), languageCodes: [lang] };
          });
          const languages = Array.from(
            new Set(voices.flatMap((v) => v.languageCodes)),
          ).sort();
          const data: Result = voices.length
            ? { voices, languages }
            : KOKORO_FALLBACK;
          bag.set(cacheKey, { expires: now + successTtlMs, data });
          return data;
        } catch (e) {
          const data: Result = {
            ...KOKORO_FALLBACK,
            diagnostics: { code: "http_error", message: (e as Error)?.message },
          };
          bag.set(cacheKey, { expires: now + errorTtlMs, data });
          return data;
        }
      }

      // Google
      const userKey = ctx.session.user.config?.llm?.googleApiKey;
      const apiKey = userKey || env.GOOGLE_API_KEY;
      if (!apiKey) {
        const empty: Result = {
          voices: [],
          languages: [],
          diagnostics: {
            code: "missing_api_key",
            message:
              "Google TTS requires an API key. Add it in Profile → Google API Key.",
          },
        };
        bag.set(cacheKey, { expires: now + 60_000, data: empty });
        return empty;
      }
      try {
        const resp = await fetch(
          `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(apiKey)}`,
          { method: "GET" },
        );
        if (!resp.ok) {
          let text = "";
          try {
            text = await resp.text();
          } catch {}
          const isAuthError =
            resp.status === 400 || resp.status === 401 || resp.status === 403;
          const empty: Result = {
            voices: [],
            languages: [],
            diagnostics: isAuthError
              ? {
                  code: "invalid_api_key",
                  message: text || "Google API key invalid or unauthorized.",
                }
              : { code: "http_error", status: resp.status, message: text },
          };
          bag.set(cacheKey, { expires: now + 60_000, data: empty });
          return empty;
        }
        const json = (await resp.json()) as {
          voices?: {
            name?: string;
            languageCodes?: string[];
            ssmlGender?: string;
          }[];
        };
        const voices: Voice[] = (json.voices || [])
          .filter((v) => typeof v.name === "string" && v.name)
          .map((v) => ({
            id: v.name as string,
            label: v.ssmlGender
              ? `${v.name} (${v.ssmlGender})`
              : (v.name as string),
            languageCodes: Array.isArray(v.languageCodes)
              ? v.languageCodes
              : [],
          }));
        const langSet = new Set<string>();
        for (const v of voices)
          for (const lc of v.languageCodes) langSet.add(lc);
        const data: Result = {
          voices,
          languages: Array.from(langSet).sort(),
        };
        bag.set(cacheKey, { expires: now + 10 * 60_000, data });
        return data;
      } catch (e) {
        const empty: Result = {
          voices: [],
          languages: [],
          diagnostics: {
            code: "http_error",
            message: (e as Error)?.message,
          },
        };
        bag.set(cacheKey, { expires: now + 60_000, data: empty });
        return empty;
      }
    }),

  // --- Rich TTS catalog merged with OpenAI/Google ---
  getTtsCatalog: protectedProcedure.query(async ({ ctx }) => {
    const providers: TtsConfigProvider[] = [];
    const languages = new Set<string>();
    const families = new Set<string>();
    const voices: TtsConfigVoice[] = [];

    // Always-available cloud providers (minimal metadata)
    providers.push({
      id: "openai",
      label: "OpenAI",
      formats: ["mp3"],
      languages: ["en-US"],
      capabilities: { ssml: false },
    });
    providers.push({
      id: "google",
      label: "Google Cloud TTS",
      formats: ["mp3", "ogg", "wav"],
      languages: [],
      capabilities: { ssml: true },
    });

    // Common OpenAI voices
    const oaVoices: TtsConfigVoice[] = [
      {
        id: "alloy",
        label: "alloy",
        languageCodes: ["en-US"],
        provider: "openai",
      },
      {
        id: "aria",
        label: "aria",
        languageCodes: ["en-US"],
        provider: "openai",
      },
      {
        id: "verse",
        label: "verse",
        languageCodes: ["en-US"],
        provider: "openai",
      },
      {
        id: "sage",
        label: "sage",
        languageCodes: ["en-US"],
        provider: "openai",
      },
      {
        id: "luna",
        label: "luna",
        languageCodes: ["en-US"],
        provider: "openai",
      },
    ];
    voices.push(...oaVoices);
    for (const v of oaVoices) {
      for (const lc of v.languageCodes) languages.add(lc);
    }

    // Google voices
    try {
      const apiKey =
        ctx.session.user.config?.llm?.googleApiKey ||
        process.env.GOOGLE_API_KEY;
      if (apiKey) {
        const resp = await fetch(
          `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(apiKey)}`,
          { method: "GET", cache: "no-store" },
        );
        if (resp.ok) {
          const json = (await resp.json()) as {
            voices?: {
              name?: string;
              languageCodes?: string[];
              ssmlGender?: string;
            }[];
          };
          const gvoices: TtsConfigVoice[] = (json.voices || [])
            .filter((v) => typeof v.name === "string" && v.name)
            .map((v) => ({
              id: v.name as string,
              label: v.ssmlGender
                ? `${v.name} (${v.ssmlGender})`
                : (v.name as string),
              languageCodes: Array.isArray(v.languageCodes)
                ? v.languageCodes
                : [],
              provider: "google",
            }));
          voices.push(...gvoices);
          const gLangs = new Set<string>();
          for (const gv of gvoices)
            for (const lc of gv.languageCodes) {
              languages.add(lc);
              gLangs.add(lc);
            }
          const gprov = providers.find((p) => p.id === "google");
          if (gprov) gprov.languages = Array.from(gLangs).sort();
        }
      }
    } catch {
      // ignore google errors
    }

    // Sidecar (kokoro-service) enrichment
    const baseUrl = (process.env.KOKORO_URL || "").replace(/\/$/, "");
    const bearer = process.env.KOKORO_BEARER || process.env.APP_TOKEN;
    if (baseUrl) {
      try {
        const cfHeaders =
          process.env.NODE_ENV === "production" &&
          !!process.env.CF_ACCESS_CLIENT_ID &&
          !!process.env.CF_ACCESS_CLIENT_SECRET
            ? {
                "CF-Access-Client-Id": process.env
                  .CF_ACCESS_CLIENT_ID as string,
                "CF-Access-Client-Secret": process.env
                  .CF_ACCESS_CLIENT_SECRET as string,
              }
            : undefined;
        const resp = await fetch(`${baseUrl}/v1/tts-config`, {
          method: "GET",
          headers: {
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
            ...(cfHeaders ?? {}),
          },
          cache: "no-store",
        });
        if (resp.ok) {
          const json = (await resp.json()) as Partial<TtsConfigResult>;
          if (Array.isArray(json.providers)) providers.push(...json.providers);
          if (Array.isArray(json.voices)) {
            for (const v of json.voices) {
              // minimal validation
              if (
                v &&
                typeof v.id === "string" &&
                typeof v.provider === "string"
              ) {
                voices.push({
                  id: v.id,
                  provider: v.provider,
                  label: v.label || v.id,
                  languageCodes: Array.isArray(v.languageCodes)
                    ? v.languageCodes
                    : [],
                  family: v.family,
                  requires: v.requires,
                });
                for (const lc of v.languageCodes || []) languages.add(lc);
                if (v.family) families.add(v.family);
              }
            }
          }
          for (const lc of json.languages || []) languages.add(lc);
          for (const f of json.families || []) families.add(f);
        }
      } catch {
        // ignore sidecar errors; return clouds only
      }
    }

    // Dedupe voices by provider:id to avoid duplicate entries (e.g., Apple say)
    const uniqueVoices = Array.from(
      new Map(voices.map((v) => [`${v.provider}:${v.id}`, v])).values(),
    );
    const catalog: TtsConfigResult = {
      providers,
      languages: Array.from(languages).sort(),
      families: Array.from(families).sort(),
      voices: uniqueVoices,
    };
    return catalog;
  }),

  // --- User TTS config ---
  getTtsConfig: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.drizzle.query.users.findFirst({
      where: eq(schema.users.id, ctx.session.user.id),
      columns: { config: true },
    });
    const tts = { ...defaultTts, ...(user?.config?.tts ?? {}) };
    return TtsConfigSchema.parse(tts);
  }),
  updateTtsConfig: protectedProcedure
    .input(TtsPatchSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: { config: true },
      });
      const next = { ...defaultTts, ...(current?.config?.tts ?? {}), ...input };
      await ctx.drizzle
        .update(schema.users)
        .set({ config: { ...(current?.config ?? {}), tts: next } })
        .where(eq(schema.users.id, ctx.session.user.id));
      return TtsConfigSchema.parse(next);
    }),

  // --- Article config ---
  getArticleConfig: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.drizzle.query.users.findFirst({
      where: eq(schema.users.id, ctx.session.user.id),
      columns: { config: true },
    });
    const articles = { ...defaultArticles, ...(user?.config?.articles ?? {}) };
    return ArticleConfigSchema.parse(articles);
  }),
  updateArticleConfig: protectedProcedure
    .input(ArticlePatchSchema)
    .mutation(async ({ ctx, input }) => {
      const current = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: { config: true },
      });
      const next = {
        ...defaultArticles,
        ...(current?.config?.articles ?? {}),
        ...input,
      };
      await ctx.drizzle
        .update(schema.users)
        .set({ config: { ...(current?.config ?? {}), articles: next } })
        .where(eq(schema.users.id, ctx.session.user.id));
      return ArticleConfigSchema.parse(next);
    }),

  updateLlmConfig: protectedProcedure
    .input(PatchSchema)
    .mutation(async ({ ctx, input }): Promise<PartialLlmConfig> => {
      const currentUser = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: { config: true },
      });

      const currentLlm = (currentUser?.config?.llm ?? {}) as Partial<z.infer<typeof LlmConfigSchema>>;
      const newLlmConfigUnnormalized = {
        ...currentLlm,
        chat: {
          ...defaultChatBaseConfig,
          ...currentLlm?.chat,
          ...input.chat,
        },
        autocomplete: {
          ...defaultAutocompleteBaseConfig,
          ...currentLlm?.autocomplete,
          ...input.autocomplete,
        },
        agent: {
          ...defaultAgentBaseConfig,
          ...currentLlm?.agent,
          ...input.agent,
        },
      } as StoredLlmConfig;

      const newLlmConfigToSave = LlmConfigSchema.parse({
        ...newLlmConfigUnnormalized,
        chat: normalizeBaseConfig(newLlmConfigUnnormalized.chat),
        autocomplete: normalizeBaseConfig(newLlmConfigUnnormalized.autocomplete),
        agent: normalizeBaseConfig(newLlmConfigUnnormalized.agent),
      });

      // Merge LLM into existing config to avoid clobbering audio/tts/articles
      const existing = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: { config: true },
      });
      await ctx.drizzle
        .update(schema.users)
        .set({
          config: {
            ...(existing?.config ?? {}),
            llm: newLlmConfigToSave,
          } as (typeof schema.users.$inferInsert)["config"],
        })
        .where(eq(schema.users.id, ctx.session.user.id));

      // Return as partial config
      return PatchSchema.parse(newLlmConfigToSave);
    }),
});
