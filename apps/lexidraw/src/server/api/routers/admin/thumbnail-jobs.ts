import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql, type SQL } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";

export const adminThumbnailJobsRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z.object({
        status: z
          .enum(["pending", "processing", "done", "error", "stale"])
          .optional(),
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
        sortBy: z
          .enum(["createdAt", "updatedAt", "status", "attempts", "nextRunAt"])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const size = input?.size ?? 50;
      const sortBy = input?.sortBy ?? "createdAt";
      const sortOrder = input?.sortOrder ?? "desc";

      const conds: SQL<unknown>[] = [];
      if (input?.status) {
        conds.push(eq(ctx.schema.thumbnailJobs.status, input.status));
      }

      let where: SQL<unknown> | undefined;
      if (conds.length === 1) where = conds[0];
      if (conds.length > 1) {
        const [first, ...rest] = conds;
        where = and(first, ...rest);
      }

      const base = ctx.drizzle
        .select({
          id: ctx.schema.thumbnailJobs.id,
          entityId: ctx.schema.thumbnailJobs.entityId,
          version: ctx.schema.thumbnailJobs.version,
          status: ctx.schema.thumbnailJobs.status,
          attempts: ctx.schema.thumbnailJobs.attempts,
          nextRunAt: ctx.schema.thumbnailJobs.nextRunAt,
          lastError: ctx.schema.thumbnailJobs.lastError,
          createdAt: ctx.schema.thumbnailJobs.createdAt,
          updatedAt: ctx.schema.thumbnailJobs.updatedAt,
        })
        .from(ctx.schema.thumbnailJobs);

      const orderByExpr = (() => {
        const orderFn = sortOrder === "asc" ? asc : desc;
        switch (sortBy) {
          case "createdAt":
            return orderFn(ctx.schema.thumbnailJobs.createdAt);
          case "updatedAt":
            return orderFn(ctx.schema.thumbnailJobs.updatedAt);
          case "status":
            return orderFn(ctx.schema.thumbnailJobs.status);
          case "attempts":
            return orderFn(ctx.schema.thumbnailJobs.attempts);
          case "nextRunAt":
            return orderFn(ctx.schema.thumbnailJobs.nextRunAt);
          default:
            return desc(ctx.schema.thumbnailJobs.createdAt);
        }
      })();

      const query = (where ? base.where(where) : base).orderBy(orderByExpr);
      const rows = await query.limit(size).offset((page - 1) * size);

      return rows;
    }),

  stats: adminProcedure.input(z.void()).query(async ({ ctx }) => {
    const [total] = await ctx.drizzle
      .select({
        count: sql<number>`count(*)`,
      })
      .from(ctx.schema.thumbnailJobs);

    const byStatus = await ctx.drizzle
      .select({
        status: ctx.schema.thumbnailJobs.status,
        count: sql<number>`count(*)`,
      })
      .from(ctx.schema.thumbnailJobs)
      .groupBy(ctx.schema.thumbnailJobs.status);

    const [errorStats] = await ctx.drizzle
      .select({
        errorCount: sql<number>`count(*)`,
        avgAttempts: sql<number>`coalesce(avg(${ctx.schema.thumbnailJobs.attempts}), 0)`,
      })
      .from(ctx.schema.thumbnailJobs)
      .where(
        sql`${ctx.schema.thumbnailJobs.lastError} is not null or ${ctx.schema.thumbnailJobs.status} = 'error'`,
      );

    const statusMap = new Map(byStatus.map((s) => [s.status, Number(s.count)]));

    return {
      total: Number(total?.count ?? 0),
      pending: statusMap.get("pending") ?? 0,
      processing: statusMap.get("processing") ?? 0,
      done: statusMap.get("done") ?? 0,
      error: statusMap.get("error") ?? 0,
      stale: statusMap.get("stale") ?? 0,
      errorCount: Number(errorStats?.errorCount ?? 0),
      avgAttempts: Number(errorStats?.avgAttempts ?? 0),
    };
  }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .delete(ctx.schema.thumbnailJobs)
        .where(eq(ctx.schema.thumbnailJobs.id, input.id));

      const sessionUserId = ctx.session?.user.id;
      if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });

      await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
        adminUserId: sessionUserId,
        action: "delete_thumbnail_job",
        targetType: "thumbnail_job",
        targetId: input.id,
        data: JSON.stringify({ jobId: input.id }),
        createdAt: new Date(),
      });

      return { ok: true } as const;
    }),
});
