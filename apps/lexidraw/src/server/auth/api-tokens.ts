import { drizzle, eq, schema } from "@packages/drizzle";
import type { Session } from "next-auth";
import { hashApiToken, type RequestAuth } from "./api-token-format";

const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export type ResolvedApiToken = {
  session: Session;
  auth: Extract<RequestAuth, { kind: "token" }>;
};

/**
 * Resolves a bearer token to the same session shape a cookie login produces,
 * so every procedure sees one kind of caller. Returns null for unknown,
 * revoked, expired, or deactivated-user tokens.
 */
export async function resolveApiToken(
  token: string,
): Promise<ResolvedApiToken | null> {
  const row = await drizzle
    .select({
      token: schema.apiTokens,
      user: {
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        image: schema.users.image,
        config: schema.users.config,
        isActive: schema.users.isActive,
      },
    })
    .from(schema.apiTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
    .where(eq(schema.apiTokens.tokenHash, hashApiToken(token)))
    .get();

  if (!row) return null;
  const now = Date.now();
  if (row.token.revokedAt) return null;
  if (row.token.expiresAt && row.token.expiresAt.getTime() < now) return null;
  if (!row.user.isActive) return null;

  const lastUsed = row.token.lastUsedAt?.getTime() ?? 0;
  if (now - lastUsed > LAST_USED_WRITE_INTERVAL_MS) {
    await drizzle
      .update(schema.apiTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(schema.apiTokens.id, row.token.id));
  }

  const session: Session = {
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email ?? undefined,
      image: row.user.image ?? undefined,
      config: (row.user.config ?? undefined) as Session["user"]["config"],
    },
    expires: (
      row.token.expiresAt ?? new Date(now + 60 * 60 * 1000)
    ).toISOString(),
  };

  return {
    session,
    auth: { kind: "token", tokenId: row.token.id, scope: row.token.scope },
  };
}
