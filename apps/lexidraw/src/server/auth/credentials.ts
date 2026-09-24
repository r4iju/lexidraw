import { and, drizzle, eq, schema } from "@packages/drizzle";
import { errorCode } from "./error-code";
import { hashPassword, needsRehash, verifyPassword } from "./password";

/**
 * Checked when there is no account or no password, so that a missing account
 * costs the same full scrypt verify as a wrong password and response time does
 * not say which emails exist. Must stay at today's parameters.
 */
const NO_ACCOUNT_HASH =
  "scrypt$131072$8$1$6YuRwPdgXDEoRH-elkgI1g$Z0HdpDQDLct55lwbQtkeTGeABVH_qkwrmq-v5tXMZFM";

/**
 * The user an email and password sign in as, without the stored hash, or null
 * when they do not match.
 *
 * A hash in an outdated format (legacy SHA-256, or scrypt below today's cost)
 * is rewritten while the plaintext is at hand, so accounts move to the current
 * format without a reset. The rewrite only replaces the hash just verified, so
 * a concurrent change wins, and its failure never fails a correct sign-in.
 */
export async function authorizeCredentials(email: string, password: string) {
  const dbUser = await drizzle.query.users.findFirst({
    where: (users, { eq }) => eq(users.email, email),
  });

  if (!dbUser?.password) {
    await verifyPassword(password, NO_ACCOUNT_HASH);
    return null;
  }
  if (!(await verifyPassword(password, dbUser.password))) return null;

  if (needsRehash(dbUser.password)) {
    try {
      await drizzle
        .update(schema.users)
        .set({ password: await hashPassword(password) })
        .where(
          and(
            eq(schema.users.id, dbUser.id),
            eq(schema.users.password, dbUser.password),
          ),
        );
    } catch (error) {
      console.error("[Auth] password rehash failed", {
        userId: dbUser.id,
        error: errorCode(error),
      });
    }
  }

  const { password: _password, ...user } = dbUser;
  return user;
}
