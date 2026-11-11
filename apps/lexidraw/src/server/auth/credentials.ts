import { and, drizzle, eq, schema, sql } from "@packages/drizzle";
import { signInInput } from "~/app/signin/schema";
import { errorCode } from "./error-code";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { withSignInLimit } from "./sign-in-rate-limit";

/**
 * Checked when there is no account or no password, so that a missing account
 * costs the same full scrypt verify as a wrong password and response time does
 * not say which emails exist. Must stay at today's parameters.
 */
const NO_ACCOUNT_HASH =
  "scrypt$131072$8$1$6YuRwPdgXDEoRH-elkgI1g$Z0HdpDQDLct55lwbQtkeTGeABVH_qkwrmq-v5tXMZFM";

/**
 * The user Auth.js credentials sign in as, without the stored hash, or null
 * when they do not match. Blank or malformed credentials are a failed sign-in
 * too, never an error, which Auth.js would report as a configuration fault.
 *
 * The email is matched whatever its case, so accounts stored before emails
 * were normalized still sign in. The spelling typed wins over a case variant,
 * so of two older accounts differing only in case, each signs in as typed.
 *
 * A hash in an outdated format (legacy SHA-256, or scrypt below today's cost)
 * is rewritten while the plaintext is at hand, so accounts move to the current
 * format without a reset. The rewrite only replaces the hash just verified, so
 * a concurrent change wins, and its failure never fails a correct sign-in.
 */
export async function authorizeCredentials(
  credentials: unknown,
  clientIp: string | null,
) {
  const parsed = signInInput.safeParse(credentials);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;
  const typed = String((credentials as { email: string }).email).trim();
  return withSignInLimit(email, clientIp, () =>
    userForPassword(email, typed, password),
  );
}

async function userForPassword(email: string, typed: string, password: string) {
  const dbUser = await drizzle.query.users.findFirst({
    where: (users) => sql`lower(${users.email}) = ${email}`,
    orderBy: (users) => [
      sql`${users.email} = ${typed} desc`,
      sql`${users.email} = ${email} desc`,
    ],
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
