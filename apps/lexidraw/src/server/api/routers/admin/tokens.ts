import { z } from "zod";
import { desc, eq } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";

export const adminTokensRouter = createTRPCRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.drizzle
      .select({
        id: ctx.schema.apiTokens.id,
        name: ctx.schema.apiTokens.name,
        scope: ctx.schema.apiTokens.scope,
        expiresAt: ctx.schema.apiTokens.expiresAt,
        lastUsedAt: ctx.schema.apiTokens.lastUsedAt,
        createdAt: ctx.schema.apiTokens.createdAt,
        revokedAt: ctx.schema.apiTokens.revokedAt,
        userId: ctx.schema.users.id,
        userName: ctx.schema.users.name,
        userEmail: ctx.schema.users.email,
      })
      .from(ctx.schema.apiTokens)
      .innerJoin(
        ctx.schema.users,
        eq(ctx.schema.users.id, ctx.schema.apiTokens.userId),
      )
      .orderBy(desc(ctx.schema.apiTokens.createdAt));
  }),

  revoke: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .update(ctx.schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(ctx.schema.apiTokens.id, input.id))
        .returning({ id: ctx.schema.apiTokens.id });
      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return { id: input.id };
    }),
});
