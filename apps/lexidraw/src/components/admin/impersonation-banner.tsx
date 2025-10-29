import "server-only";
import { authEffective } from "~/server/auth";
import { drizzle, schema, eq } from "@packages/drizzle";
import StopImpersonationButton from "./stop-impersonation-button";

export default async function ImpersonationBanner() {
  const session = await authEffective();
  const isImpersonating = Boolean(session?.user?.isImpersonating);
  const targetUserId = session?.user?.effectiveUserId;
  if (!isImpersonating || !targetUserId) return null;

  const [target] = await drizzle
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, targetUserId))
    .limit(1);

  const label = target?.name || target?.email || targetUserId;

  return (
    <div className="sticky top-[var(--header-height)] z-40 border-b border-muted bg-secondary text-secondary-foreground">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-2 text-sm">
        <div>
          Impersonating
          <span className="mx-2 rounded bg-muted px-2 py-0.5 font-medium text-foreground">
            {label}
          </span>
          <span className="text-muted-foreground">(acting as this user)</span>
        </div>
        <StopImpersonationButton />
      </div>
    </div>
  );
}
