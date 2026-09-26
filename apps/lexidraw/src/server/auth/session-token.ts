import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { cache } from "react";
import { eq, schema, type drizzle } from "@packages/drizzle";
import { errorCode } from "~/server/auth/error-code";

type Db = typeof drizzle;

/**
 * The token a session is read from. Signing in puts the user's settings on
 * it; `update()` from the page, after Settings are saved, reads the user
 * again, so the AI routes see the settings as stored. Nothing the page sends
 * with the update is taken: the name, email and settings are the stored ones.
 *
 * A signed token outlives its account, so every read checks the user is still
 * there; null signs the browser out. A database that cannot answer is not an
 * answer, so the token stands, rather than every browser being signed out.
 */
export async function sessionToken(
  db: Db,
  {
    token,
    user,
    trigger,
  }: {
    token: JWT;
    user?: unknown;
    trigger?: "signIn" | "signUp" | "update";
    session?: unknown;
  },
): Promise<JWT | null> {
  if (user) {
    token.config = (user as Session["user"]).config;
    return token;
  }
  if (!token.sub) return token;
  let stored: Awaited<ReturnType<typeof storedUser>>;
  try {
    stored = await storedUser(db, token.sub);
  } catch (error) {
    console.error("[auth] the session's user could not be read", {
      error: errorCode(error),
    });
    return token;
  }
  if (!stored) return null;
  if (trigger !== "update") return token;
  return {
    ...token,
    name: stored.name,
    email: stored.email,
    picture: stored.image,
    config: stored.config,
  };
}

/** Once per request: a page asks for the session from several places. */
const storedUser = cache((db: Db, userId: string) =>
  db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: { name: true, email: true, image: true, config: true },
  }),
);
