import { TRPCError } from "@trpc/server";
import { getSignUpSchema } from "~/app/signup/schema";
import { ProfileSchema } from "~/app/profile/schema";
import env from "@packages/env";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq, inArray } from "@packages/drizzle";

export const authRouter = createTRPCRouter({
  signUp: publicProcedure
    .input(getSignUpSchema())
    .mutation(async ({ ctx, input }) => {
      try {
        // create user
        const encoder = new TextEncoder();
        const data = encoder.encode(input.password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashedPassword = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        await ctx.drizzle.insert(schema.users).values({
          email: input.email,
          name: input.name,
          password: hashedPassword,
        });

        return true;
      } catch (error) {
        console.error(error);
        // don't tell why
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Something went wrong",
        });
      }
    }),
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const users = await ctx.drizzle
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        config: schema.users.config,
      })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.session.user.id));
    if (users.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    return users[0];
  }),
  getLlmConfig: protectedProcedure.query(async ({ ctx }) => {
    const users = await ctx.drizzle
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.session.user.id));
    return users[0]?.config?.llm;
  }),
  updateProfile: protectedProcedure
    .input(ProfileSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUser = await ctx.drizzle
        .select({ config: schema.users.config })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.session.user.id))
        .limit(1);

      const currentConfig = currentUser[0]?.config ?? {};

      // Validate LLM configs against policies
      const modes = ["chat", "agent", "autocomplete"] as const;
      const policies = await ctx.drizzle
        .select({
          mode: schema.llmPolicies.mode,
          allowedModels: schema.llmPolicies.allowedModels,
          enforcedCaps: schema.llmPolicies.enforcedCaps,
        })
        .from(schema.llmPolicies)
        .where(inArray(schema.llmPolicies.mode, modes));

      const policyMap = new Map(policies.map((p) => [p.mode, p] as const));

      // Validate each mode's config if provided
      for (const mode of modes) {
        const userConfig = input[mode];
        if (!userConfig) continue;

        const policy = policyMap.get(mode);
        if (!policy) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No policy found for mode: ${mode}`,
          });
        }

        // Validate model if both provider and modelId are provided
        if (userConfig.provider && userConfig.modelId) {
          const isAllowed = policy.allowedModels.some(
            (allowed) =>
              allowed.provider === userConfig.provider &&
              allowed.modelId === userConfig.modelId,
          );

          if (!isAllowed) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Model ${userConfig.provider}:${userConfig.modelId} is not allowed for ${mode} mode. Allowed models: ${policy.allowedModels.map((m) => `${m.provider}:${m.modelId}`).join(", ")}`,
            });
          }
        }

        // Validate maxOutputTokens against enforced caps if provided
        if (
          userConfig.maxOutputTokens &&
          userConfig.provider &&
          policy.enforcedCaps?.maxOutputTokensByProvider
        ) {
          const providerCap =
            policy.enforcedCaps.maxOutputTokensByProvider[
              userConfig.provider as keyof typeof policy.enforcedCaps.maxOutputTokensByProvider
            ];
          if (
            providerCap !== undefined &&
            userConfig.maxOutputTokens > providerCap
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Max output tokens (${userConfig.maxOutputTokens}) exceeds the cap for ${userConfig.provider} (${providerCap}) in ${mode} mode`,
            });
          }
        }
      }

      await ctx.drizzle
        .update(schema.users)
        .set({
          name: input.name,
          email: input.email,
          config: {
            ...currentConfig,
            llm: {
              // Preserve existing API keys if they exist
              googleApiKey: currentConfig.llm?.googleApiKey,
              openaiApiKey: currentConfig.llm?.openaiApiKey,
              chat: input.chat ?? currentConfig.llm?.chat,
              agent: input.agent ?? currentConfig.llm?.agent,
              autocomplete:
                input.autocomplete ?? currentConfig.llm?.autocomplete,
            },
            // Merge optional TTS and Article config if provided
            tts: {
              ...currentConfig.tts,
              ...input.tts,
            },
            articles: {
              ...currentConfig.articles,
              ...input.articles,
            },
          },
        })
        .where(eq(schema.users.id, ctx.session.user.id));
      return;
    }),
  iceServers: publicProcedure.query(() => {
    return env.ICE_SERVER_CONFIG satisfies RTCIceServer[];
  }),
});
