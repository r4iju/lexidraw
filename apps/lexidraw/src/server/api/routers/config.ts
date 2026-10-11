import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { autoSaveEnabled } from "~/lib/auto-save";
import { listenSettings, TTS_PROVIDERS } from "~/app/settings/schema";
import {
  type createTRPCContext,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq, sql } from "@packages/drizzle";
import {
  DEFAULT_GOOGLE_AGENT_MODEL_ID,
  DEFAULT_GOOGLE_AUTOCOMPLETE_MODEL_ID,
  DEFAULT_GOOGLE_CHAT_MODEL_ID,
  DEFAULT_OPENAI_AUTOCOMPLETE_MODEL_ID,
} from "~/lib/llm-models";

export const LlmBaseConfigSchema = z.object({
  modelId: z.string(),
  provider: z.string(),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().positive(),
});

export const LlmConfigSchema = z.object({
  chat: LlmBaseConfigSchema,
  autocomplete: LlmBaseConfigSchema,
  agent: LlmBaseConfigSchema,
});

export const PatchSchema = z.object({
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
  capabilities?: { ssml?: boolean };
};
export type TtsConfigVoice = TtsVoice & {
  provider: string;
  family?: string;
};
export type TtsConfigResult = {
  providers: TtsConfigProvider[];
  languages: string[];
  families: string[];
  voices: TtsConfigVoice[];
  diagnostics?: TtsOptionsDiagnostics;
};

// Define separate defaults
const defaultChatBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  modelId: DEFAULT_GOOGLE_CHAT_MODEL_ID,
  provider: "google",
  temperature: 0.7,
  maxOutputTokens: 100000,
};

const defaultAutocompleteBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  modelId: DEFAULT_GOOGLE_AUTOCOMPLETE_MODEL_ID,
  provider: "google",
  temperature: 0.3,
  maxOutputTokens: 500,
};

const defaultAgentBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  // For now mirror chat defaults; can be tuned separately later
  modelId: DEFAULT_GOOGLE_AGENT_MODEL_ID,
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
  provider: z.enum(TTS_PROVIDERS),
  voiceId: z.string(),
  speed: z.number().min(0.25).max(4),
  format: z.enum(["mp3", "ogg", "wav"]),
  languageCode: z.string(),
  sampleRate: z.number().int().positive().optional(),
});
const TtsPatchSchema = z.strictObject({
  speed: z.number().min(0.25).max(4).optional(),
});

const ArticleConfigSchema = z.object({
  languageCode: z.string(),
  maxChars: z.number().int().positive(),
  keepQuotes: z.boolean(),
  autoGenerateAudioOnImport: z.boolean(),
});
const ArticlePatchSchema = ArticleConfigSchema.partial();

const defaultArticles: z.infer<typeof ArticleConfigSchema> = {
  languageCode: "en-US",
  maxChars: 120000,
  keepQuotes: true,
  autoGenerateAudioOnImport: false,
};

/**
 * The settings the caller has stored. A visitor reading a public document or
 * link has no account and so nothing stored, which is the same as a new
 * account: every settings read answers its defaults rather than refusing.
 * The writes stay behind an account.
 */
async function storedConfig(
  ctx: Pick<
    Awaited<ReturnType<typeof createTRPCContext>>,
    "drizzle" | "session"
  >,
) {
  const userId = ctx.session?.user?.id;
  if (!userId) return undefined;
  const user = await ctx.drizzle.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { config: true },
  });
  return user?.config ?? undefined;
}

// Each path is applied to the current row in the UPDATE, so another request's
// source or settings cannot be restored from a captured account config.
function patchConfigSubtree(
  section: "tts" | "articles" | "audio" | "autoSave",
  patch: Record<string, unknown>,
) {
  const current = sql`coalesce(nullif(${schema.users.config}, 'null'), '{}')`;
  let subtree = sql`coalesce(json_extract(${current}, ${`$.${section}`}), '{}')`;
  for (const [key, value] of Object.entries(patch)) {
    subtree = sql`json_set(${subtree}, ${`$.${key}`}, json(${JSON.stringify(value)}))`;
  }
  return sql`json_set(${current}, ${`$.${section}`}, json(${subtree}))`;
}

export const configRouter = createTRPCRouter({
  getAutocompleteModelOptions: protectedProcedure.query(async ({ ctx }) => {
    const [policy] = await ctx.drizzle
      .select({
        provider: schema.llmPolicies.provider,
        modelId: schema.llmPolicies.modelId,
        allowedModels: schema.llmPolicies.allowedModels,
      })
      .from(schema.llmPolicies)
      .where(eq(schema.llmPolicies.mode, "autocomplete"))
      .limit(1);

    const allowed = Array.isArray(policy?.allowedModels)
      ? policy.allowedModels
      : [];

    // Autocomplete currently uses OpenAI Responses API in server actions/routes,
    // so only OpenAI model IDs are meaningful here.
    const openaiAllowed = allowed
      .filter((m) => m?.provider === "openai" && typeof m.modelId === "string")
      .map((m) => m.modelId);

    // Ensure the policy default is present if it's OpenAI (even if allowlist is empty/misaligned).
    const defaultIfOpenai =
      policy?.provider === "openai" && typeof policy.modelId === "string"
        ? policy.modelId
        : undefined;

    const uniqueIds = Array.from(
      new Set([
        ...(defaultIfOpenai ? [defaultIfOpenai] : []),
        ...openaiAllowed,
      ]),
    ).filter(Boolean);

    return {
      defaultModelId:
        defaultIfOpenai ?? uniqueIds[0] ?? DEFAULT_OPENAI_AUTOCOMPLETE_MODEL_ID,
      models: uniqueIds.map((id) => ({ id, label: id })),
    };
  }),

  // --- Autocomplete (separate, minimal engine) ---
  getAutocompleteConfig: publicProcedure.query(async ({ ctx }) => {
    const config = await storedConfig(ctx);
    return { enabled: config?.autocomplete?.enabled === true };
  }),
  updateAutocompleteConfig: protectedProcedure
    .input(z.strictObject({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(schema.users)
        .set({
          config: sql`json_set(coalesce(nullif(${schema.users.config}, 'null'), '{}'), '$.autocomplete', json(${JSON.stringify(input)}))`,
        })
        .where(eq(schema.users.id, ctx.session.user.id));
      return input;
    }),
  getConfig: publicProcedure.query(
    async ({ ctx }): Promise<StoredLlmConfig> => {
      const config = await storedConfig(ctx);

      const existingLlm: Partial<StoredLlmConfig> = config?.llm ?? {};
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
  getAudioConfig: publicProcedure.query(async ({ ctx }) => {
    const config = await storedConfig(ctx);
    const preferredPlaybackRate = config?.audio?.preferredPlaybackRate ?? 1;
    return { preferredPlaybackRate };
  }),

  updateAudioConfig: protectedProcedure
    .input(
      z.object({
        preferredPlaybackRate: z.number().min(0.5).max(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(schema.users)
        .set({ config: patchConfigSubtree("audio", input) })
        .where(eq(schema.users.id, ctx.session.user.id));

      return { preferredPlaybackRate: input.preferredPlaybackRate };
    }),

  // --- Auto-save preferences ---
  getAutoSaveConfig: publicProcedure.query(async ({ ctx }) => {
    const config = await storedConfig(ctx);
    return { enabled: autoSaveEnabled(config?.autoSave) };
  }),

  updateAutoSaveConfig: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(schema.users)
        .set({ config: patchConfigSubtree("autoSave", input) })
        .where(eq(schema.users.id, ctx.session.user.id));

      return { enabled: input.enabled };
    }),

  // Compatibility endpoints describe unavailable synthesis without contacting providers.
  getTtsOptions: protectedProcedure
    .input(z.strictObject({ provider: z.enum(TTS_PROVIDERS) }))
    .query(
      (): TtsOptionsResult => ({
        voices: [],
        languages: [],
        diagnostics: {
          code: "http_error",
          message:
            "Legacy voice services are unavailable. Use AI Power or saved playback.",
        },
      }),
    ),
  getTtsCatalog: protectedProcedure.query(
    (): TtsConfigResult => ({
      providers: [],
      languages: [],
      families: [],
      voices: [],
    }),
  ),

  // --- User TTS config ---
  getTtsConfig: publicProcedure.query(async ({ ctx }) => {
    const config = await storedConfig(ctx);
    return TtsConfigSchema.parse(listenSettings(config?.tts));
  }),
  updateTtsConfig: protectedProcedure
    .input(TtsPatchSchema)
    .mutation(async ({ ctx, input }) => {
      const [saved] = await ctx.drizzle
        .update(schema.users)
        .set({ config: patchConfigSubtree("tts", input) })
        .where(eq(schema.users.id, ctx.session.user.id))
        .returning({ config: schema.users.config });
      return TtsConfigSchema.parse(listenSettings(saved?.config?.tts));
    }),

  // --- Article config ---
  getArticleConfig: publicProcedure.query(async ({ ctx }) => {
    const config = await storedConfig(ctx);
    const articles = { ...defaultArticles, ...(config?.articles ?? {}) };
    return ArticleConfigSchema.parse(articles);
  }),
  updateArticleConfig: protectedProcedure
    .input(ArticlePatchSchema)
    .mutation(async ({ ctx, input }) => {
      const [saved] = await ctx.drizzle
        .update(schema.users)
        .set({ config: patchConfigSubtree("articles", input) })
        .where(eq(schema.users.id, ctx.session.user.id))
        .returning({ config: schema.users.config });
      return ArticleConfigSchema.parse({
        ...defaultArticles,
        ...saved?.config?.articles,
      });
    }),

  updateLlmConfig: protectedProcedure
    .input(PatchSchema)
    .mutation((): PartialLlmConfig => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Use AI Power. Legacy model settings are unavailable.",
      });
    }),
});
