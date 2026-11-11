import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import { and, drizzle, eq, inArray, lt, schema, sql } from "@packages/drizzle";
import { errorCode } from "./error-code";

/**
 * The email counters count failed passwords only, so a stranger guessing from
 * one client locks out that client and never the real user elsewhere. The
 * email backstop still bounds guessing from many clients at once.
 */
export const SIGN_IN_LIMITS = {
  windowMs: 15 * 60_000,
  emailAndClient: { maxFailures: 10 },
  email: { maxFailures: 100 },
  client: { maxAttempts: 30 },
} as const;

export type SignInLimit = "emailAndClient" | "email" | "client";

/**
 * The address a request came from: the first `x-forwarded-for` hop, else
 * `x-real-ip`, else null.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || null;
}

/**
 * The client an address counts as. An IPv6 address counts under its /64, the
 * smallest block a provider hands one customer, so rotating addresses within
 * it does not reset a limit. Addresses written with an embedded IPv4 part stay
 * whole, so IPv4-mapped clients do not all share one bucket.
 */
function ipBucket(ip: string) {
  if (!isIPv6(ip) || ip.includes(".")) return ip;
  const [head = "", tail] = ip.split("::");
  const groups = head ? head.split(":") : [];
  if (tail !== undefined) {
    const tailGroups = tail ? tail.split(":") : [];
    groups.push(
      ...Array<string>(8 - groups.length - tailGroups.length).fill("0"),
      ...tailGroups,
    );
  }
  const prefix = groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

function attemptKey(limit: SignInLimit, value: string) {
  return createHash("sha256").update(`${limit}:${value}`).digest("hex");
}

function currentWindowStart() {
  const { windowMs } = SIGN_IN_LIMITS;
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

/**
 * An unknown client gets no client counter, and its failures share one
 * email-and-client counter per email.
 */
function counterKeys(email: string, ip: string | null) {
  const client = ip ? ipBucket(ip) : null;
  return {
    emailAndClient: attemptKey("emailAndClient", `${email}\n${client ?? ""}`),
    email: attemptKey("email", email),
    client: client ? attemptKey("client", client) : null,
  };
}

type CounterKeys = ReturnType<typeof counterKeys>;

const { signInAttempts: table } = schema;

function increment(keys: string[]) {
  return drizzle
    .insert(table)
    .values(
      keys.map((key) => ({ key, windowStart: currentWindowStart(), count: 1 })),
    )
    .onConflictDoUpdate({
      target: table.key,
      set: {
        count: sql`CASE WHEN ${table.windowStart} = excluded.windowStart THEN ${table.count} + 1 ELSE 1 END`,
        windowStart: sql`excluded.windowStart`,
      },
    })
    .returning({ key: table.key, count: table.count });
}

/**
 * Counts the attempt against its client, and returns the limit that refuses
 * it, or null. Refused attempts count against the client too, so hammering
 * past its limit keeps it shut until the window ends.
 */
async function refusal(keys: CounterKeys): Promise<SignInLimit | null> {
  const failures = await drizzle
    .select({ key: table.key, count: table.count })
    .from(table)
    .where(
      and(
        inArray(table.key, [keys.emailAndClient, keys.email]),
        eq(table.windowStart, currentWindowStart()),
      ),
    );
  const failed = (key: string) =>
    failures.find((row) => row.key === key)?.count ?? 0;
  const [client] = keys.client ? await increment([keys.client]) : [];

  if (failed(keys.email) >= SIGN_IN_LIMITS.email.maxFailures) return "email";
  if (failed(keys.emailAndClient) >= SIGN_IN_LIMITS.emailAndClient.maxFailures)
    return "emailAndClient";
  if (client && client.count > SIGN_IN_LIMITS.client.maxAttempts)
    return "client";
  return null;
}

/**
 * Runs a password check under the sign-in limits, for an email already
 * normalized. An attempt past a limit is refused like a wrong password before
 * the check runs, so a refused attempt costs no scrypt. A failed check counts
 * against the email from this client and against the email overall; a
 * successful one clears this client's failures for the email.
 *
 * When the store cannot count, the attempt goes ahead: the limit guards
 * against abuse, and must not turn a counter outage into a sign-in outage.
 */
export async function withSignInLimit<T>(
  email: string,
  ip: string | null,
  check: () => Promise<T | null>,
): Promise<T | null> {
  const keys = counterKeys(email, ip);
  const limit = await refusal(keys).catch((error) => {
    console.error("[Auth] sign-in attempt not counted", {
      error: errorCode(error),
    });
    return null;
  });
  if (limit) {
    console.warn("[Auth] sign-in refused", { error: "RATE_LIMITED", limit });
    return null;
  }

  const user = await check();
  try {
    if (user)
      await drizzle.delete(table).where(eq(table.key, keys.emailAndClient));
    else await increment([keys.emailAndClient, keys.email]);
  } catch (error) {
    console.error("[Auth] sign-in outcome not counted", {
      error: errorCode(error),
    });
  }
  return user;
}

/** Drops the counts of windows that have ended. */
export async function purgeExpiredSignInAttempts() {
  await drizzle
    .delete(schema.signInAttempts)
    .where(lt(schema.signInAttempts.windowStart, currentWindowStart()));
}
