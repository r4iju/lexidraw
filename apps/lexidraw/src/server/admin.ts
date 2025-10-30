import "server-only";
import { auth } from "~/server/auth";
import { drizzle, schema, eq } from "@packages/drizzle";
import { redirect } from "next/navigation";

export async function isAdmin(): Promise<boolean> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return false;

  const rows = await drizzle
    .select({ roleName: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, userId));

  return rows.some((r) => r.roleName === "admin");
}

export async function assertAdminOrRedirect() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/signin");

  const rows = await drizzle
    .select({ roleName: schema.roles.name })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, userId));

  const isAdmin = rows.some((r) => r.roleName === "admin");
  if (!isAdmin) redirect("/");
}
