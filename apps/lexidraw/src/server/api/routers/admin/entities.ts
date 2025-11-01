import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { and, desc, eq, like, sql, type SQL } from "@packages/drizzle";
import { TRPCError } from "@trpc/server";
import { generateUUID } from "~/lib/utils";

export const adminEntitiesRouter = createTRPCRouter({
  members: adminProcedure
    .input(z.object({ entityId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.drizzle
        .select({
          userId: ctx.schema.sharedEntities.userId,
          name: ctx.schema.users.name,
          email: ctx.schema.users.email,
        })
        .from(ctx.schema.sharedEntities)
        .leftJoin(
          ctx.schema.users,
          eq(ctx.schema.sharedEntities.userId, ctx.schema.users.id),
        )
        .where(eq(ctx.schema.sharedEntities.entityId, input.entityId));
      return rows;
    }),
  list: adminProcedure
    .input(
      z.object({
        query: z.string().optional(),
        ownerId: z.string().optional(),
        status: z.enum(["active", "inactive"]).optional(),
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const size = input?.size ?? 50;
      const q = input?.query?.trim();
      const conds: SQL<unknown>[] = [];
      if (q && q.length > 0)
        conds.push(like(ctx.schema.entities.title, `%${q}%`));
      if (input?.ownerId)
        conds.push(eq(ctx.schema.entities.userId, input.ownerId));
      if (input?.status === "active")
        conds.push(eq(ctx.schema.entities.isActive, 1));
      if (input?.status === "inactive")
        conds.push(eq(ctx.schema.entities.isActive, 0));

      let where: SQL<unknown> | undefined;
      if (conds.length === 1) where = conds[0];
      if (conds.length > 1) {
        const [first, ...rest] = conds;
        where = and(first, ...rest);
      }

      const base = ctx.drizzle
        .select({
          id: ctx.schema.entities.id,
          title: ctx.schema.entities.title,
          entityType: ctx.schema.entities.entityType,
          ownerId: ctx.schema.entities.userId,
          ownerName: ctx.schema.users.name,
          ownerEmail: ctx.schema.users.email,
          isActive: ctx.schema.entities.isActive,
          createdAt: ctx.schema.entities.createdAt,
          lastActivity: sql<number>`coalesce((select max(e.createdAt) from ${ctx.schema.llmAuditEvents} e where e.entityId = ${ctx.schema.entities.id}), 0)`,
          membersCount: sql<number>`coalesce((select count(*) from ${ctx.schema.sharedEntities} se where se.entityId = ${ctx.schema.entities.id}), 0)`,
        })
        .from(ctx.schema.entities)
        .leftJoin(
          ctx.schema.users,
          eq(ctx.schema.entities.userId, ctx.schema.users.id),
        );

      const rows = await (where ? base.where(where) : base)
        .orderBy(desc(ctx.schema.entities.createdAt))
        .limit(size)
        .offset((page - 1) * size);
      return rows;
    }),

  get: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.drizzle
        .select({
          id: ctx.schema.entities.id,
          title: ctx.schema.entities.title,
          ownerId: ctx.schema.entities.userId,
          isActive: ctx.schema.entities.isActive,
          createdAt: ctx.schema.entities.createdAt,
        })
        .from(ctx.schema.entities)
        .where(eq(ctx.schema.entities.id, input.id))
        .limit(1);
      return row ?? null;
    }),

  toggleActive: adminProcedure
    .input(z.object({ entityId: z.string().min(1), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(ctx.schema.entities)
        .set({ isActive: input.active ? 1 : 0, updatedAt: new Date() })
        .where(eq(ctx.schema.entities.id, input.entityId));
      const sessionUserId = ctx.session?.user.id;
      if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
        adminUserId: sessionUserId,
        action: input.active ? "activate_entity" : "deactivate_entity",
        targetType: "entity",
        targetId: input.entityId,
        createdAt: new Date(),
      });
      return { ok: true } as const;
    }),

  transferOwnership: adminProcedure
    .input(
      z.object({ entityId: z.string().min(1), newOwnerId: z.string().min(1) }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(ctx.schema.entities)
        .set({ userId: input.newOwnerId, updatedAt: new Date() })
        .where(eq(ctx.schema.entities.id, input.entityId));
      const sessionUserId = ctx.session?.user.id;
      if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
        adminUserId: sessionUserId,
        action: "transfer_ownership",
        targetType: "entity",
        targetId: input.entityId,
        data: JSON.stringify({ newOwnerId: input.newOwnerId }),
        createdAt: new Date(),
      });
      return { ok: true } as const;
    }),

  addMember: adminProcedure
    .input(z.object({ entityId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle.insert(ctx.schema.sharedEntities).values({
        id: generateUUID(),
        entityId: input.entityId,
        userId: input.userId,
        accessLevel: "editor",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const sessionUserId = ctx.session?.user.id;
      if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
        adminUserId: sessionUserId,
        action: "add_member",
        targetType: "entity",
        targetId: input.entityId,
        data: JSON.stringify({ userId: input.userId }),
        createdAt: new Date(),
      });
      return { ok: true } as const;
    }),

  removeMember: adminProcedure
    .input(z.object({ entityId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .delete(ctx.schema.sharedEntities)
        .where(
          and(
            eq(ctx.schema.sharedEntities.entityId, input.entityId),
            eq(ctx.schema.sharedEntities.userId, input.userId),
          ),
        );
      const sessionUserId = ctx.session?.user.id;
      if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
        adminUserId: sessionUserId,
        action: "remove_member",
        targetType: "entity",
        targetId: input.entityId,
        data: JSON.stringify({ userId: input.userId }),
        createdAt: new Date(),
      });
      return { ok: true } as const;
    }),

  exportCsv: adminProcedure
    .input(
      z.object({
        query: z.string().optional(),
        ownerId: z.string().optional(),
        status: z.enum(["active", "inactive", "all"]).optional(),
        sortField: z
          .enum(["createdAt", "title", "ownerId", "isActive", "membersCount"])
          .optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conds: SQL<unknown>[] = [];
      const q = input?.query?.trim();
      if (q && q.length > 0)
        conds.push(like(ctx.schema.entities.title, `%${q}%`));
      if (input?.ownerId)
        conds.push(eq(ctx.schema.entities.userId, input.ownerId));
      if (input?.status === "active")
        conds.push(eq(ctx.schema.entities.isActive, 1));
      if (input?.status === "inactive")
        conds.push(eq(ctx.schema.entities.isActive, 0));

      let where: SQL<unknown> | undefined;
      if (conds.length === 1) where = conds[0];
      if (conds.length > 1) {
        const [first, ...rest] = conds;
        where = and(first, ...rest);
      }

      const base = ctx.drizzle
        .select({
          id: ctx.schema.entities.id,
          title: ctx.schema.entities.title,
          ownerId: ctx.schema.entities.userId,
          isActive: ctx.schema.entities.isActive,
          createdAt: ctx.schema.entities.createdAt,
        })
        .from(ctx.schema.entities);
      const rows = await (where ? base.where(where) : base)
        .orderBy(desc(ctx.schema.entities.createdAt))
        .limit(1000);
      const head = ["id", "title", "ownerId", "isActive", "createdAt"].join(
        ",",
      );
      const body = (rows as unknown as Array<Record<string, unknown>>)
        .map((r) =>
          [r.id, r.title, r.ownerId, r.isActive, r.createdAt]
            .map((v) => (v == null ? "" : String(v).replaceAll('"', '"')))
            .join(","),
        )
        .join("\n");
      return `${head}\n${body}`;
    }),
});
