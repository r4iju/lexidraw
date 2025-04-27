import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq } from "@packages/drizzle";

// Define the Zod schema for the LLM base configuration, matching drizzle-schema.ts
const LlmBaseConfigSchema = z.object({
  modelId: z.string(),
  provider: z.string(),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().int().positive(),
});

export const LlmConfigSchema = z.object({
  enabled: z.boolean(),
  googleApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  chat: LlmBaseConfigSchema.optional(),
  autocomplete: LlmBaseConfigSchema.optional(),
});

// Define the type for the partial config used as input/output
type PartialLlmConfig = z.infer<ReturnType<typeof LlmConfigSchema.partial>>;

export const configRouter = createTRPCRouter({
  getConfig: protectedProcedure.query(
    async ({ ctx }): Promise<PartialLlmConfig> => {
      const user = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: {
          config: true,
        },
      });

      const llmConfig = user?.config?.llm ?? { enabled: false };
      // Ensure the returned object matches the partial schema, especially `enabled`
      return LlmConfigSchema.partial().parse(llmConfig);
    },
  ),

  updateLlmConfig: protectedProcedure
    .input(LlmConfigSchema.partial())
    .mutation(async ({ ctx, input }): Promise<PartialLlmConfig> => {
      const currentUser = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: {
          config: true,
        },
      });

      const currentConfig = currentUser?.config ?? {};
      const currentLlmConfig: PartialLlmConfig = currentConfig.llm ?? {};

      // Merge, ensuring enabled is explicitly handled if not in input
      const mergedLlmConfig = {
        ...currentLlmConfig,
        ...input,
        enabled: input.enabled ?? currentLlmConfig.enabled ?? false, // Ensure enabled is always boolean
      };

      // Validate the merged config before saving
      const newLlmConfig = LlmConfigSchema.partial().parse(mergedLlmConfig);

      await ctx.drizzle
        .update(schema.users)
        .set({
          config: {
            ...currentConfig,
            // Ensure the llm object being saved matches the drizzle schema type
            llm: {
              ...newLlmConfig,
              enabled: newLlmConfig.enabled ?? false, // Ensure enabled is boolean
            },
          },
        })
        .where(eq(schema.users.id, ctx.session.user.id));

      return newLlmConfig;
    }),
});
