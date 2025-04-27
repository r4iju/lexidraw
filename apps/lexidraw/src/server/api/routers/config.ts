import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq } from "@packages/drizzle";

// Export the base schema
export const LlmBaseConfigSchema = z.object({
  enabled: z.boolean().default(false),
  modelId: z.string(),
  provider: z.string(),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().positive(),
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

// Define separate defaults
const defaultChatBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  enabled: false,
  modelId: "gemini-2.0-flash",
  provider: "google",
  temperature: 0.7,
  maxTokens: 100000,
};

const defaultAutocompleteBaseConfig: z.infer<typeof LlmBaseConfigSchema> = {
  enabled: false,
  modelId: "gemini-2.0-flash-lite",
  provider: "google",
  temperature: 0.3,
  maxTokens: 500,
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

  updateLlmConfig: protectedProcedure
    .input(PatchSchema)
    .mutation(async ({ ctx, input }): Promise<PartialLlmConfig> => {
      const currentUser = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: {
          config: true,
        },
      });

      const currentConfig = currentUser?.config ?? {};
      const currentLlmConfig: Partial<StoredLlmConfig> =
        currentConfig.llm ?? {};

      const ensureBaseConfigDefaults = (
        cfg: Partial<z.infer<typeof LlmBaseConfigSchema>> | undefined,
        mode: "chat" | "autocomplete",
      ): z.infer<typeof LlmBaseConfigSchema> => {
        const defaults =
          mode === "chat"
            ? defaultChatBaseConfig
            : defaultAutocompleteBaseConfig;
        return {
          enabled: cfg?.enabled ?? defaults.enabled,
          modelId: cfg?.modelId ?? defaults.modelId,
          provider: cfg?.provider ?? defaults.provider,
          temperature: cfg?.temperature ?? defaults.temperature,
          maxTokens: cfg?.maxTokens ?? defaults.maxTokens,
        };
      };

      const mergedLlmConfig: Partial<StoredLlmConfig> = {
        ...currentLlmConfig,
        chat:
          input.chat || currentLlmConfig.chat
            ? ensureBaseConfigDefaults(
                {
                  ...currentLlmConfig.chat,
                  ...input.chat,
                },
                "chat",
              )
            : currentLlmConfig.chat,
        autocomplete:
          input.autocomplete || currentLlmConfig.autocomplete
            ? ensureBaseConfigDefaults(
                {
                  ...currentLlmConfig.autocomplete,
                  ...input.autocomplete,
                },
                "autocomplete",
              )
            : currentLlmConfig.autocomplete,
        googleApiKey: input.googleApiKey ?? currentLlmConfig.googleApiKey,
        openaiApiKey: input.openaiApiKey ?? currentLlmConfig.openaiApiKey,
      };

      // Parse against full schema before saving
      const newLlmConfigToSave = LlmConfigSchema.parse(mergedLlmConfig);

      await ctx.drizzle
        .update(schema.users)
        .set({
          config: {
            ...currentConfig,
            llm: newLlmConfigToSave,
          },
        })
        .where(eq(schema.users.id, ctx.session.user.id));

      // Return as partial config
      return PatchSchema.parse(newLlmConfigToSave);
    }),
});
