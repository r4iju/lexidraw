import {
  createHash,
  randomBytes,
  scrypt,
  type ScryptOptions,
  timingSafeEqual,
} from "node:crypto";

/**
 * Every read and write of `users.password` goes through here.
 *
 * Stored as `scrypt$N$r$p$salt$hash` (base64url salt and hash) so the cost can
 * be raised later: `needsRehash` flags anything not at today's parameters and
 * sign-in rewrites it once the password is known. N=2^17, r=8, p=1 is OWASP's
 * baseline for scrypt: 128 MiB and ~180 ms per hash on an M-series laptop,
 * inside a serverless function's memory and a sign-in's latency budget. The
 * async `scrypt` runs on the libuv pool, so it does not stall the event loop.
 * `node:crypto` rather than `Bun.password` because Vercel runs the auth route
 * on Node.
 *
 * Accounts created before this were stored as an unsalted SHA-256 hex digest.
 * Those still verify, in constant time, and are always flagged for rehash.
 */
const PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const LEGACY_SHA256 = /^[0-9a-f]{64}$/;

type Parsed =
  | {
      kind: "scrypt";
      N: number;
      r: number;
      p: number;
      salt: Buffer;
      key: Buffer;
    }
  | { kind: "sha256"; digest: Buffer };

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  { N, r, p }: { N: number; r: number; p: number },
) {
  // Node refuses anything over 32 MiB unless told otherwise; scrypt needs
  // about 128 * N * r bytes.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

function parse(stored: string): Parsed | null {
  if (LEGACY_SHA256.test(stored)) {
    return { kind: "sha256", digest: Buffer.from(stored, "hex") };
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return null;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const key = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length === 0 || key.length === 0) return null;
  return { kind: "scrypt", N, r, p, salt, key };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, PARAMS);
  const { N, r, p } = PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  if (parsed.kind === "sha256") {
    const digest = createHash("sha256").update(password).digest();
    return timingSafeEqual(digest, parsed.digest);
  }
  try {
    const key = await derive(password, parsed.salt, parsed.key.length, parsed);
    return timingSafeEqual(key, parsed.key);
  } catch {
    // Parameters scrypt rejects, e.g. an N that is not a power of two.
    return false;
  }
}

export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return (
    parsed?.kind !== "scrypt" ||
    parsed.N !== PARAMS.N ||
    parsed.r !== PARAMS.r ||
    parsed.p !== PARAMS.p
  );
}
