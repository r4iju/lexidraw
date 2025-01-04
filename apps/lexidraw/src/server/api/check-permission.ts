import { TRPCError } from "@trpc/server";
import { createTRPCContext } from "./trpc";
import { drizzle, schema, eq } from "@packages/drizzle";

export const checkPermission = async (
  ctx: Awaited<ReturnType<typeof createTRPCContext>>,
  requiredPermission: string,
) => {
  const userId = ctx.session?.user?.id;

  if (!userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const userPermissions = await drizzle
    .select({
      permissionName: schema.permissions.name,
    })
    .from(schema.userRoles)
    .innerJoin(
      schema.rolePermissions,
      eq(schema.userRoles.roleId, schema.rolePermissions.roleId),
    )
    .innerJoin(
      schema.permissions,
      eq(schema.rolePermissions.permissionId, schema.permissions.id),
    )
    .where(eq(schema.userRoles.userId, userId));

  const hasPermission = userPermissions.some(
    (permission) => permission.permissionName === requiredPermission,
  );

  if (!hasPermission) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
};
