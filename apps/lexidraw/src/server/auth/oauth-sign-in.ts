import { AuthError, type Account, type Profile, type User } from "next-auth";
import { and, eq, schema, type drizzle } from "@packages/drizzle";

type Db = typeof drizzle;

/**
 * Refused as Auth.js refuses an email it will not link, so the sign-in page
 * explains it the same way.
 */
export class OAuthAccountNotLinked extends AuthError {
  static type = "OAuthAccountNotLinked";
  static kind = "signIn";
}

/**
 * Whether the provider says it verified the email it signed in with. GitHub
 * is never taken at its word: the address Auth.js reads from it can be one
 * GitHub has not verified.
 */
export function providerProvedEmail(provider: string, profile: object) {
  if (provider !== "apple") return false;
  const verified = (profile as { email_verified?: unknown }).email_verified;
  // Apple has sent this claim both as a boolean and as a string.
  return verified === true || verified === "true";
}

/**
 * The linking policy for every OAuth sign-in, run before Auth.js looks
 * anything up. A provider account seen for the first time, with nobody signed
 * in, lands on an existing account of the same email only when both sides
 * have proven that email: the provider verified it, and so was the account's.
 * Emails are otherwise never checked, so anyone could have registered
 * someone else's address first and would receive their sign-in.
 *
 * Anyone signed in links the provider to themselves whatever its email, as
 * Auth.js does. A refusal throws `OAuthAccountNotLinked`.
 */
export async function admitOAuthSignIn(
  db: Db,
  {
    user,
    account,
    profile,
  }: { user: User; account?: Account | null; profile?: Profile },
  signedInUserId: () => Promise<string | null>,
): Promise<true> {
  if (!account || (account.type !== "oauth" && account.type !== "oidc")) {
    return true;
  }
  const linked = await db.query.accounts.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.accounts.provider, account.provider),
      eq(schema.accounts.providerAccountId, account.providerAccountId),
    ),
  });
  if (linked || !user.email) return true;

  const existing = await db.query.users.findFirst({
    columns: { emailVerified: true },
    where: eq(schema.users.email, user.email),
  });
  if (!existing) return true;
  if (await signedInUserId()) return true;
  if (
    existing.emailVerified != null &&
    providerProvedEmail(account.provider, profile ?? {})
  ) {
    return true;
  }
  throw new OAuthAccountNotLinked(
    "The email belongs to an account that has not proven it on both sides",
  );
}
