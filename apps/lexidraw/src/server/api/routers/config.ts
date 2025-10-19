import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq } from "@packages/drizzle";

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
      } satisfies NonNullable<(typeof schema.users)["config"]>;

      await ctx.drizzle
        .update(schema.users)
        .set({ config: nextConfig })
        .where(eq(schema.users.id, ctx.session.user.id));

      return { preferredPlaybackRate: input.preferredPlaybackRate };
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

      await ctx.drizzle
        .update(schema.users)
        .set({ config: { llm: newLlmConfigToSave } })
        .where(eq(schema.users.id, ctx.session.user.id));

      // Return as partial config
      return PatchSchema.parse(newLlmConfigToSave);
    }),
});
