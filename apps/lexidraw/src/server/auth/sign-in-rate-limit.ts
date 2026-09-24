import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import { drizzle, lt, schema, sql } from "@packages/drizzle";

export const SIGN_IN_LIMITS = {
  windowMs: 15 * 60_000,
  email: { max: 10 },
  ip: { max: 30 },
} as const;

export type SignInLimit = "email" | "ip";

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
 * The IP limit's bucket for an address. An IPv6 address counts under its /64,
 * the smallest block a provider hands one customer, so rotating addresses
 * within it does not reset the limit. Addresses written with an embedded IPv4
 * part stay whole, so IPv4-mapped clients do not all share one bucket.
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
 * Counts one sign-in attempt against the email and, when known, the IP, and
 * returns the limit it went past, or null while both are within theirs. Every
 * call counts, refused ones included, so hammering past a limit keeps it shut
 * until the window ends.
 */
export async function takeSignInAttempt(
  email: string,
  ip: string | null,
): Promise<SignInLimit | null> {
  const windowStart = currentWindowStart();
  const keys = new Map<string, SignInLimit>([
    [attemptKey("email", email.trim().toLowerCase()), "email"],
  ]);
  if (ip) keys.set(attemptKey("ip", ipBucket(ip)), "ip");

  const { signInAttempts: table } = schema;
  const counted = await drizzle
    .insert(table)
    .values([...keys.keys()].map((key) => ({ key, windowStart, count: 1 })))
    .onConflictDoUpdate({
      target: table.key,
      set: {
        count: sql`CASE WHEN ${table.windowStart} = excluded.windowStart THEN ${table.count} + 1 ELSE 1 END`,
        windowStart: sql`excluded.windowStart`,
      },
    })
    .returning({ key: table.key, count: table.count });

  const over = counted.flatMap(({ key, count }) => {
    const limit = keys.get(key);
    return limit && count > SIGN_IN_LIMITS[limit].max ? [limit] : [];
  });
  return over.includes("email") ? "email" : (over[0] ?? null);
}

/** Drops the counts of windows that have ended. */
export async function purgeExpiredSignInAttempts() {
  await drizzle
    .delete(schema.signInAttempts)
    .where(lt(schema.signInAttempts.windowStart, currentWindowStart()));
}
