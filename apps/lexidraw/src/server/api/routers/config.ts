import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq } from "@packages/drizzle";

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

      await ctx.drizzle
        .update(schema.users)
        .set({
          config: {
            llm: newLlmConfigToSave,
          },
        })
        .where(eq(schema.users.id, ctx.session.user.id));

      // Return as partial config
      return PatchSchema.parse(newLlmConfigToSave);
    }),
});
