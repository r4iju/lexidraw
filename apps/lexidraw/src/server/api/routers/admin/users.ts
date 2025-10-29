import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { z } from "zod";
import { and, desc, eq, inArray, like, sql, type SQL } from "@packages/drizzle";
import { cookies } from "next/headers";
import { TRPCError } from "@trpc/server";

export const adminUsersRouter = createTRPCRouter({
  listRoles: adminProcedure.input(z.void()).query(async ({ ctx }) => {
    const rows = await ctx.drizzle
      .select({ id: ctx.schema.roles.id, name: ctx.schema.roles.name })
      .from(ctx.schema.roles)
      .orderBy(ctx.schema.roles.name);
    return rows;
  }),

  list: adminProcedure
    .input(
      z.object({
        query: z.string().optional(),
        roleIds: z.array(z.number().int()).optional(),
        status: z.enum(["active", "inactive"]).optional(),
        page: z.number().int().min(1).optional(),
        size: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const size = input?.size ?? 20;
      const q = input?.query?.trim();
      const whereConds: SQL<unknown>[] = [];
      if (q && q.length > 0) {
        whereConds.push(like(ctx.schema.users.name, `%${q}%`));
      }
      if (input?.status === "active")
        whereConds.push(eq(ctx.schema.users.isActive, 1));
      if (input?.status === "inactive")
        whereConds.push(eq(ctx.schema.users.isActive, 0));

      let whereUsers: SQL<unknown> | undefined;
      if (whereConds.length === 1) whereUsers = whereConds[0];
      if (whereConds.length > 1) {
        const [first, ...rest] = whereConds;
        whereUsers = and(first, ...rest);
      }

      const base = ctx.drizzle
        .select({
          id: ctx.schema.users.id,
          name: ctx.schema.users.name,
          email: ctx.schema.users.email,
          isActive: ctx.schema.users.isActive,
          createdAt: ctx.schema.users.createdAt,
          roles: sql<string[]>`(
            select json_group_array(r.name)
            from ${ctx.schema.userRoles} ur
            join ${ctx.schema.roles} r on ur.roleId = r.id
            where ur.userId = ${sql.raw('"Users"."id"')}
          )`,
          lastActive: sql<number>`coalesce((select max(e.createdAt) from ${ctx.schema.llmAuditEvents} e where e.userId = ${sql.raw('"Users"."id"')}), 0)`,
          requests30d: sql<number>`coalesce((select count(*) from ${ctx.schema.llmAuditEvents} e where e.userId = ${sql.raw('"Users"."id"')} and e.createdAt >= ${Date.now() - 30 * 24 * 60 * 60 * 1000}), 0)`,
        })
        .from(ctx.schema.users);

      const withWhere = whereUsers ? base.where(whereUsers) : base;

      const rows = await withWhere
        .orderBy(desc(ctx.schema.users.createdAt))
        .limit(size)
        .offset((page - 1) * size);

      // Optional role filter post-query for simplicity
      const roleFilter = input?.roleIds;
      if (roleFilter && roleFilter.length > 0) {
        const roleNames = await ctx.drizzle
          .select({ id: ctx.schema.roles.id, name: ctx.schema.roles.name })
          .from(ctx.schema.roles)
          .where(inArray(ctx.schema.roles.id, roleFilter));
        const allowed = new Set(roleNames.map((r) => r.name));
        return rows.filter((r) => {
          const list = JSON.parse(
            (r as unknown as { roles: string }).roles ?? "[]",
          ) as string[];
          return list.some((name) => allowed.has(name));
        });
      }
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
          isActive: ctx.schema.users.isActive,
          createdAt: ctx.schema.users.createdAt,
          roles: sql<string[]>`(
            select json_group_array(r.name)
            from ${ctx.schema.userRoles} ur
            join ${ctx.schema.roles} r on ur.roleId = r.id
            where ur.userId = ${sql.raw('"Users"."id"')}
          )`,
        })
        .from(ctx.schema.users)
        .where(eq(ctx.schema.users.id, input.id))
        .limit(1);
      return user ?? null;
    }),

  updateRoles: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        roleIds: z.array(z.number().int()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // remove all, then insert desired
      await ctx.drizzle
        .delete(ctx.schema.userRoles)
        .where(eq(ctx.schema.userRoles.userId, input.userId));
      if (input.roleIds.length > 0) {
        await ctx.drizzle
          .insert(ctx.schema.userRoles)
          .values(
            input.roleIds.map((rid) => ({ userId: input.userId, roleId: rid })),
          );
      }
      {
        const sessionUserId = ctx.session?.user.id;
        if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
        await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
          adminUserId: sessionUserId,
          action: "update_roles",
          targetType: "user",
          targetId: input.userId,
          data: JSON.stringify({ roleIds: input.roleIds }),
          createdAt: new Date(),
        });
      }
      return { ok: true } as const;
    }),

  toggleActive: adminProcedure
    .input(z.object({ userId: z.string().min(1), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(ctx.schema.users)
        .set({ isActive: input.active ? 1 : 0, updatedAt: new Date() })
        .where(eq(ctx.schema.users.id, input.userId));
      {
        const sessionUserId = ctx.session?.user.id;
        if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
        await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
          adminUserId: sessionUserId,
          action: input.active ? "activate_user" : "deactivate_user",
          targetType: "user",
          targetId: input.userId,
          createdAt: new Date(),
        });
      }
      return { ok: true } as const;
    }),

  impersonateStart: adminProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const jar = await cookies();
      jar.set({
        name: "impersonate_user_id",
        value: input.userId,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      {
        const sessionUserId = ctx.session?.user.id;
        if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
        await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
          adminUserId: sessionUserId,
          action: "impersonate_start",
          targetType: "user",
          targetId: input.userId,
          createdAt: new Date(),
        });
      }
      return { ok: true } as const;
    }),

  impersonateStop: adminProcedure.input(z.void()).mutation(async ({ ctx }) => {
    const jar = await cookies();
    jar.set({
      name: "impersonate_user_id",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(0),
    });
    {
      const sessionUserId = ctx.session?.user.id;
      if (!sessionUserId) throw new TRPCError({ code: "UNAUTHORIZED" });
      await ctx.drizzle.insert(ctx.schema.adminAuditEvents).values({
        adminUserId: sessionUserId,
        action: "impersonate_stop",
        targetType: "user",
        targetId: sessionUserId,
        createdAt: new Date(),
      });
    }
    return { ok: true } as const;
  }),

  exportCsv: adminProcedure
    .input(
      z.object({
        query: z.string().optional(),
        status: z.enum(["active", "inactive"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Re-run a lightweight version of the list query for CSV
      const whereConds: SQL<unknown>[] = [];
      const q = input?.query?.trim();
      if (q && q.length > 0)
        whereConds.push(like(ctx.schema.users.name, `%${q}%`));
      if (input?.status === "active")
        whereConds.push(eq(ctx.schema.users.isActive, 1));
      if (input?.status === "inactive")
        whereConds.push(eq(ctx.schema.users.isActive, 0));

      let whereUsers: SQL<unknown> | undefined;
      if (whereConds.length === 1) whereUsers = whereConds[0];
      if (whereConds.length > 1) {
        const [first, ...rest] = whereConds;
        whereUsers = and(first, ...rest);
      }

      const base = ctx.drizzle
        .select({
          id: ctx.schema.users.id,
          name: ctx.schema.users.name,
          email: ctx.schema.users.email,
          isActive: ctx.schema.users.isActive,
          createdAt: ctx.schema.users.createdAt,
        })
        .from(ctx.schema.users);

      const withWhere = whereUsers ? base.where(whereUsers) : base;
      const rows = await withWhere
        .orderBy(desc(ctx.schema.users.createdAt))
        .limit(1000);
      const head = ["id", "name", "email", "isActive", "createdAt"].join(",");
      const body = (rows as unknown as Array<Record<string, unknown>>)
        .map((r) =>
          [r.id, r.name, r.email, r.isActive, r.createdAt]
            .map((v) => (v == null ? "" : String(v).replaceAll('"', '"')))
            .join(","),
        )
        .join("\n");
      return `${head}\n${body}`;
    }),
});
