import { and, drizzle, eq, schema } from "@packages/drizzle";
import { hashPassword, needsRehash, verifyPassword } from "./password";

/**
 * The user an email and password sign in as, without the stored hash, or null
 * when they do not match. A hash stored in an outdated format is replaced
 * while the plaintext is at hand.
 */
export async function authorizeCredentials(email: string, password: string) {
  const dbUser = await drizzle.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, email),
  });

  if (!dbUser?.password) return null;
  if (!(await verifyPassword(password, dbUser.password))) return null;

  if (needsRehash(dbUser.password)) {
    // Only over the hash just verified, so a concurrent change wins. A failed
    // upgrade must not fail a sign-in whose password was correct.
    await drizzle
      .update(schema.users)
      .set({ password: await hashPassword(password) })
      .where(
        and(
          eq(schema.users.id, dbUser.id),
          eq(schema.users.password, dbUser.password),
        ),
      )
      .catch((error: unknown) =>
        console.error("[auth] password rehash failed", error),
      );
  }

  const { password: _password, ...user } = dbUser;
  return user;
}
