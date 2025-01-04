import { auth } from "~/server/auth";
import { headers as nextHeaders } from "next/headers";
import env from "@packages/env";
import { drizzle, eq, schema } from "@packages/drizzle";

export const canRunCron = async () => {
  // system cron
  const headers = await nextHeaders();
  const authorization = headers.get("Authorization");
  if (authorization === `Bearer ${env.CRON_SECRET}`) return true;

  // user cron
  const session = await auth();
  if (!session) return false;
  const userId = session.user.id;
  const requiredPermission = "run_cron";
  // join users with user roles, role with permissions
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

  // Check if the user has the required permission
  const hasPermission = userPermissions.some(
    (permission) => permission.permissionName === requiredPermission,
  );

  return hasPermission;
};
