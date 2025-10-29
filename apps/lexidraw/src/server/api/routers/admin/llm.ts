import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { and, desc, eq, like, sql, type SQL } from "@packages/drizzle";
import {
  LLMPolicySchema,
  PoliciesGetAllOutputSchema,
  UpsertPolicyInputSchema,
} from "./llm.policy.schemas";

export const adminLlmRouter = createTRPCRouter({
  policies: createTRPCRouter({
    getAll: adminProcedure.input(z.void()).query(async ({ ctx }) => {
      const rows = await ctx.drizzle
        .select({
          id: ctx.schema.llmPolicies.id,
          mode: ctx.schema.llmPolicies.mode,
          provider: ctx.schema.llmPolicies.provider,
          modelId: ctx.schema.llmPolicies.modelId,
          temperature: ctx.schema.llmPolicies.temperature,
          maxOutputTokens: ctx.schema.llmPolicies.maxOutputTokens,
          allowedModels: ctx.schema.llmPolicies.allowedModels,
          enforcedCaps: ctx.schema.llmPolicies.enforcedCaps,
        })
        .from(ctx.schema.llmPolicies)
        .orderBy(ctx.schema.llmPolicies.mode);

      return PoliciesGetAllOutputSchema.parse(rows);
    }),

    upsert: adminProcedure
      .input(UpsertPolicyInputSchema)
      .mutation(async ({ ctx, input }) => {
        // Normalize (example: ensure temperature bounds and positive tokens)
        const normalized = LLMPolicySchema.parse(input);

        const existing = await ctx.drizzle
          .select({ id: ctx.schema.llmPolicies.id })
          .from(ctx.schema.llmPolicies)
          .where(eq(ctx.schema.llmPolicies.mode, normalized.mode))
          .limit(1);

        if (existing.length > 0) {
          await ctx.drizzle
            .update(ctx.schema.llmPolicies)
            .set({
              provider: normalized.provider,
              modelId: normalized.modelId,
              temperature: normalized.temperature,
              maxOutputTokens: normalized.maxOutputTokens,
              allowedModels: normalized.allowedModels,
              enforcedCaps: normalized.enforcedCaps,
              updatedAt: new Date(),
            })
            .where(eq(ctx.schema.llmPolicies.id, existing[0]?.id ?? 0));
        } else {
          await ctx.drizzle.insert(ctx.schema.llmPolicies).values({
            mode: normalized.mode,
            provider: normalized.provider,
            modelId: normalized.modelId,
            temperature: normalized.temperature,
            maxOutputTokens: normalized.maxOutputTokens,
            allowedModels: normalized.allowedModels,
            enforcedCaps: normalized.enforcedCaps,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        const row = await ctx.drizzle
          .select({
            id: ctx.schema.llmPolicies.id,
            mode: ctx.schema.llmPolicies.mode,
            provider: ctx.schema.llmPolicies.provider,
            modelId: ctx.schema.llmPolicies.modelId,
            temperature: ctx.schema.llmPolicies.temperature,
            maxOutputTokens: ctx.schema.llmPolicies.maxOutputTokens,
            allowedModels: ctx.schema.llmPolicies.allowedModels,
            enforcedCaps: ctx.schema.llmPolicies.enforcedCaps,
          })
          .from(ctx.schema.llmPolicies)
          .where(eq(ctx.schema.llmPolicies.mode, normalized.mode))
          .limit(1);

        return LLMPolicySchema.extend({ id: z.number() }).parse(row[0]);
      }),
  }),

  users: createTRPCRouter({
    list: adminProcedure
      .input(
        z.object({
          query: z.string().optional(),
          page: z.number().int().min(1).optional(),
          size: z.number().int().min(1).max(200).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const page = input?.page ?? 1;
        const size = input?.size ?? 20;
        const q = input?.query?.trim();
        const now = Date.now();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const from = now - thirtyDaysMs;

        let whereUsers: SQL<unknown> | undefined;
        if (q && q.length > 0) {
          whereUsers = like(ctx.schema.users.name, `%${q}%`);
        }

        const baseUsersQuery = ctx.drizzle
          .select({
            id: ctx.schema.users.id,
            name: ctx.schema.users.name,
            email: ctx.schema.users.email,
            requests30d: sql<number>`(select count(*) from ${ctx.schema.llmAuditEvents} e where e.userId = ${ctx.schema.users.id} and e.createdAt >= ${from})`,
            tokens30d: sql<number>`coalesce((select sum(e.totalTokens) from ${ctx.schema.llmAuditEvents} e where e.userId = ${ctx.schema.users.id} and e.createdAt >= ${from}), 0)`,
            lastActive: sql<number>`coalesce((select max(e.createdAt) from ${ctx.schema.llmAuditEvents} e where e.userId = ${ctx.schema.users.id}), 0)`,
          })
          .from(ctx.schema.users);
        const rows = await (whereUsers
          ? baseUsersQuery.where(whereUsers)
          : baseUsersQuery
        )
          .orderBy(ctx.schema.users.name)
          .limit(size)
          .offset((page - 1) * size);

        return rows;
      }),

    get: adminProcedure
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const [user] = await ctx.drizzle
          .select({
            id: ctx.schema.users.id,
            name: ctx.schema.users.name,
            email: ctx.schema.users.email,
            config: ctx.schema.users.config,
          })
          .from(ctx.schema.users)
          .where(eq(ctx.schema.users.id, input.id))
          .limit(1);
        return user ?? null;
      }),
  }),

  usage: createTRPCRouter({
    list: adminProcedure
      .input(
        z.object({
          from: z.number().optional(),
          to: z.number().optional(),
          mode: z.string().optional(),
          provider: z.string().optional(),
          userId: z.string().optional(),
          entityId: z.string().optional(),
          route: z.string().optional(),
          error: z.boolean().optional(),
          page: z.number().int().min(1).optional(),
          size: z.number().int().min(1).max(200).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const page = input?.page ?? 1;
        const size = input?.size ?? 50;

        const conds: SQL<unknown>[] = [];
        if (input?.from)
          conds.push(
            sql`${ctx.schema.llmAuditEvents.createdAt} >= ${input.from}`,
          );
        if (input?.to)
          conds.push(
            sql`${ctx.schema.llmAuditEvents.createdAt} <= ${input.to}`,
          );
        if (input?.mode)
          conds.push(eq(ctx.schema.llmAuditEvents.mode, input.mode));
        if (input?.provider)
          conds.push(eq(ctx.schema.llmAuditEvents.provider, input.provider));
        if (input?.userId)
          conds.push(eq(ctx.schema.llmAuditEvents.userId, input.userId));
        if (input?.entityId)
          conds.push(eq(ctx.schema.llmAuditEvents.entityId, input.entityId));
        if (input?.route)
          conds.push(eq(ctx.schema.llmAuditEvents.route, input.route));
        if (input?.error === true)
          conds.push(sql`${ctx.schema.llmAuditEvents.errorCode} IS NOT NULL`);
        if (input?.error === false)
          conds.push(sql`${ctx.schema.llmAuditEvents.errorCode} IS NULL`);

        let whereUsage: SQL<unknown> | undefined;
        if (conds.length === 1) whereUsage = conds[0];
        if (conds.length > 1) {
          const [first, ...rest] = conds;
          whereUsage = and(first, ...rest);
        }

        const baseUsageQuery = ctx.drizzle
          .select({
            id: ctx.schema.llmAuditEvents.id,
            createdAt: ctx.schema.llmAuditEvents.createdAt,
            requestId: ctx.schema.llmAuditEvents.requestId,
            userId: ctx.schema.llmAuditEvents.userId,
            userEmail: ctx.schema.users.email,
            entityId: ctx.schema.llmAuditEvents.entityId,
            mode: ctx.schema.llmAuditEvents.mode,
            route: ctx.schema.llmAuditEvents.route,
            provider: ctx.schema.llmAuditEvents.provider,
            modelId: ctx.schema.llmAuditEvents.modelId,
            totalTokens: ctx.schema.llmAuditEvents.totalTokens,
            latencyMs: ctx.schema.llmAuditEvents.latencyMs,
            errorCode: ctx.schema.llmAuditEvents.errorCode,
            httpStatus: ctx.schema.llmAuditEvents.httpStatus,
          })
          .from(ctx.schema.llmAuditEvents)
          .leftJoin(
            ctx.schema.users,
            eq(ctx.schema.llmAuditEvents.userId, ctx.schema.users.id),
          );
        const rows = await (whereUsage
          ? baseUsageQuery.where(whereUsage)
          : baseUsageQuery
        )
          .orderBy(desc(ctx.schema.llmAuditEvents.createdAt))
          .limit(size)
          .offset((page - 1) * size);

        return rows;
      }),

    getByRequestId: adminProcedure
      .input(z.object({ requestId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const [row] = await ctx.drizzle
          .select()
          .from(ctx.schema.llmAuditEvents)
          .where(eq(ctx.schema.llmAuditEvents.requestId, input.requestId))
          .limit(1);
        return row ?? null;
      }),
  }),
});
