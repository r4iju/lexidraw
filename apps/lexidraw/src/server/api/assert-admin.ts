import { TRPCError } from "@trpc/server";
import type { createTRPCContext } from "./trpc";
import { eq } from "@packages/drizzle";

export const assertAdmin = async (
  ctx: Awaited<ReturnType<typeof createTRPCContext>>,
) => {
  const userId = ctx.session?.user?.id;
  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const rows = await ctx.drizzle
    .select({ roleName: ctx.schema.roles.name })
    .from(ctx.schema.userRoles)
    .innerJoin(
      ctx.schema.roles,
      eq(ctx.schema.userRoles.roleId, ctx.schema.roles.id),
    )
    .where(eq(ctx.schema.userRoles.userId, userId));

  const isAdmin = rows.some((r) => r.roleName === "admin");
  if (!isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
};
