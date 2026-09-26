import { z } from "zod";
import { and, desc, eq } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  sessionOnlyProcedure,
  tokenOnlyProcedure,
} from "~/server/api/trpc";
import { createApiToken } from "~/server/auth/api-tokens";

const MAX_TOKEN_TTL_DAYS = 3650;

export const CreateApiToken = z.object({
  name: z.string().trim().min(1).max(64),
  scope: z.enum(["read", "write"]),
  expiresInDays: z.number().int().positive().max(MAX_TOKEN_TTL_DAYS).nullable(),
});

export const tokensRouter = createTRPCRouter({
  list: sessionOnlyProcedure.query(async ({ ctx }) => {
    return ctx.drizzle
      .select({
        id: ctx.schema.apiTokens.id,
        name: ctx.schema.apiTokens.name,
        scope: ctx.schema.apiTokens.scope,
        expiresAt: ctx.schema.apiTokens.expiresAt,
        lastUsedAt: ctx.schema.apiTokens.lastUsedAt,
        createdAt: ctx.schema.apiTokens.createdAt,
        revokedAt: ctx.schema.apiTokens.revokedAt,
      })
      .from(ctx.schema.apiTokens)
      .where(eq(ctx.schema.apiTokens.userId, ctx.session.user.id))
      .orderBy(desc(ctx.schema.apiTokens.createdAt));
  }),

  create: sessionOnlyProcedure
    .input(CreateApiToken)
    .mutation(({ ctx, input }) =>
      createApiToken(ctx.drizzle, {
        userId: ctx.session.user.id,
        name: input.name,
        scope: input.scope,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
      }),
    ),

  revoke: sessionOnlyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .update(ctx.schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(ctx.schema.apiTokens.id, input.id),
            eq(ctx.schema.apiTokens.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: ctx.schema.apiTokens.id });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { id: input.id };
    }),

  /** Signing out a device: the token the request carries, and no other. */
  revokeCurrent: tokenOnlyProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/me/token/revoke",
        tags: ["auth"],
        summary: "Revoke the token this request carries",
        description:
          "For signing a device or a CLI out. Every later request with the token is a 401; other tokens are untouched.",
        protect: true,
      },
    })
    .input(z.object({}))
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx }) => {
      await ctx.drizzle
        .update(ctx.schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(ctx.schema.apiTokens.id, ctx.auth.tokenId));
      return { id: ctx.auth.tokenId };
    }),
});
