import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSignUpSchema } from "~/app/signup/schema";
import { SettingsSchema } from "~/app/settings/schema";
import env from "@packages/env";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { schema } from "@packages/drizzle";
import { eq, inArray } from "@packages/drizzle";
import { errorCode } from "~/server/auth/error-code";
import { hashPassword } from "~/server/auth/password";

/**
 * Lays a settings change over what is stored: a value replaces, null removes
 * the key so the default applies again, and a missing key is left alone.
 */
function applyOverrides<T extends object>(
  current: T | undefined,
  change: Record<string, unknown> | undefined,
): T | undefined {
  if (!change) return current;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next as T;
}

export const authRouter = createTRPCRouter({
  signUp: publicProcedure
    .input(getSignUpSchema())
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.drizzle.insert(schema.users).values({
          email: input.email,
          name: input.name,
          password: await hashPassword(input.password),
        });

        return true;
      } catch (error) {
        console.error("[Auth] sign-up failed", { error: errorCode(error) });
        // don't tell why
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Something went wrong",
        });
      }
    }),
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.drizzle
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        config: schema.users.config,
      })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.session.user.id));
    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    return user;
  }),
  getLlmConfig: protectedProcedure.query(async ({ ctx }) => {
    const users = await ctx.drizzle
      .select({ config: schema.users.config })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.session.user.id));
    return users[0]?.config?.llm;
  }),
  updateProfile: protectedProcedure
    .input(SettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const currentUser = await ctx.drizzle
        .select({ config: schema.users.config })
        .from(schema.users)
        .where(eq(schema.users.id, ctx.session.user.id))
        .limit(1);

      const currentConfig = currentUser[0]?.config ?? {};

      // Validate LLM configs against policies
      const modes: ("chat" | "agent" | "autocomplete")[] = [
        "chat",
        "agent",
        "autocomplete",
      ];
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

      const llm = currentConfig.llm ?? {};
      const nextConfig = {
        ...currentConfig,
        llm: {
          ...llm,
          chat: applyOverrides(llm.chat, input.chat),
          agent: applyOverrides(
            (llm as { agent?: Record<string, unknown> }).agent,
            input.agent,
          ),
        },
        // Autocomplete has its own engine, which reads this key.
        autocomplete: applyOverrides(
          currentConfig.autocomplete,
          input.autocomplete,
        ),
        tts: applyOverrides(currentConfig.tts, input.tts),
        ...(typeof input.autoSave === "boolean" && {
          autoSave: { ...currentConfig.autoSave, enabled: input.autoSave },
        }),
      };

      await ctx.drizzle
        .update(schema.users)
        .set({
          name: input.name,
          email: input.email,
          config:
            nextConfig as unknown as (typeof schema.users.$inferInsert)["config"],
        })
        .where(eq(schema.users.id, ctx.session.user.id));
      return;
    }),
  /**
   * Who the caller is, over any transport. A CLI holding a token needs a cheap
   * way to check that it is still valid and what it may do; every other REST
   * path costs a document read.
   */
  me: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/me",
        tags: ["auth"],
        summary: "The user and scope the request resolves to",
        protect: true,
      },
    })
    .input(z.object({}))
    .output(
      z.object({
        userId: z.string(),
        email: z.string().nullable(),
        authKind: z.enum(["session", "token"]),
        scope: z.enum(["read", "write"]).nullable(),
      }),
    )
    .query(({ ctx }) => ({
      userId: ctx.session.user.id,
      email: ctx.session.user.email ?? null,
      authKind: ctx.auth.kind,
      scope: ctx.auth.kind === "token" ? ctx.auth.scope : null,
    })),
  iceServers: publicProcedure.query(() => {
    return env.ICE_SERVER_CONFIG satisfies RTCIceServer[];
  }),
});
