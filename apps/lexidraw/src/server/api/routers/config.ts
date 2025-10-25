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
});

export const PatchSchema = z.object({
  googleApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  chat: LlmBaseConfigSchema.partial().optional(),
  autocomplete: LlmBaseConfigSchema.partial().optional(),
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

// --- TTS and Article Config Schemas & Defaults ---
const TtsConfigSchema = z.object({
  provider: z.enum(["openai", "google", "kokoro"]),
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
  getConfig: protectedProcedure.query(
    async ({ ctx }): Promise<StoredLlmConfig> => {
      const user = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: {
          config: true,
        },
      });

      const llmConfig = {
        ...defaultChatBaseConfig,
        ...user?.config?.llm,
        chat: {
          ...defaultChatBaseConfig,
          ...user?.config?.llm?.chat,
        },
        autocomplete: {
          ...defaultAutocompleteBaseConfig,
          ...user?.config?.llm?.autocomplete,
        },
      } satisfies StoredLlmConfig;

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
    .input(z.object({ provider: z.enum(["openai", "google", "kokoro"]) }))
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
        const data: Result = {
          voices: [
            { id: "af_heart", label: "af_heart", languageCodes: ["en-US"] },
          ],
          languages: ["en-US"],
        };
        bag.set(cacheKey, { expires: now + 10 * 60_000, data });
        return data;
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

  // --- TTS config ---
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

      const newLlmConfigToSave = LlmConfigSchema.parse({
        ...currentUser?.config?.llm,
        chat: {
          ...defaultChatBaseConfig,
          ...currentUser?.config?.llm?.chat,
          ...input.chat,
        },
        autocomplete: {
          ...defaultAutocompleteBaseConfig,
          ...currentUser?.config?.llm?.autocomplete,
          ...input.autocomplete,
        },
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
