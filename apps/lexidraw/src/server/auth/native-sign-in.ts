import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import env from "@packages/env";
import { and, eq, gt, isNotNull, isNull, lt, schema } from "@packages/drizzle";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { createApiToken } from "./api-tokens";

type Db = LibSQLDatabase<typeof schema>;

/** Long enough for the browser to hand the code to the app, and no longer. */
const NATIVE_SIGN_IN_CODE_TTL_MS = 60_000;

/** How long a spent code is remembered. */
const SPENT_CODE_RETENTION_MS = 24 * 60 * 60 * 1000;

const TOKEN_NAME_MAX = 64;

/**
 * A device name as the Settings token list will show it: control, format and
 * bidi-override characters become spaces, so a name cannot hide or reorder
 * what is printed around it.
 */
function sanitizeDeviceName(name: string): string {
  const cleaned = name.replace(/\p{C}/gu, " ").replace(/\s+/g, " ").trim();
  let out = "";
  for (const char of cleaned) {
    if (out.length + char.length > TOKEN_NAME_MAX) break;
    out += char;
  }
  return out.trim();
}

/** Base64url of a SHA-256, as RFC 7636 spells an S256 challenge. */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 §4.1. */
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * What a native app sends the browser to: where to return, the PKCE challenge
 * the code will be bound to, and what to call the token. The same parse guards
 * the consent page and the approval it submits.
 */
export const NativeSignInRequest = z.object({
  redirectUri: z
    .string()
    .refine((uri) => env.NATIVE_SIGN_IN_CALLBACKS.includes(uri), {
      message: "Unknown callback",
    }),
  codeChallenge: z.string().regex(CODE_CHALLENGE),
  codeChallengeMethod: z.literal("S256"),
  deviceName: z
    .string()
    .max(1024)
    .transform(sanitizeDeviceName)
    .pipe(z.string().min(1)),
});
export type NativeSignInRequest = z.infer<typeof NativeSignInRequest>;

export const NativeSignInExchange = z.object({
  code: z.string().min(1).max(256),
  codeVerifier: z.string().regex(CODE_VERIFIER),
  redirectUri: z.string().min(1).max(2048),
});
export type NativeSignInExchange = z.infer<typeof NativeSignInExchange>;

const hashCode = (code: string) =>
  createHash("sha256").update(code).digest("hex");

const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/**
 * Issues the one-time code for `userId`, bound to the request's challenge,
 * callback and device name, and answers the URL that hands it to the app.
 */
export async function issueNativeSignInCode(
  db: Db,
  userId: string,
  request: NativeSignInRequest,
): Promise<URL> {
  const now = Date.now();
  await db
    .delete(schema.nativeSignInCodes)
    .where(
      lt(
        schema.nativeSignInCodes.expiresAt,
        new Date(now - SPENT_CODE_RETENTION_MS),
      ),
    );
  const code = randomBytes(32).toString("base64url");
  await db.insert(schema.nativeSignInCodes).values({
    codeHash: hashCode(code),
    userId,
    codeChallenge: request.codeChallenge,
    redirectUri: request.redirectUri,
    deviceName: request.deviceName,
    expiresAt: new Date(now + NATIVE_SIGN_IN_CODE_TTL_MS),
  });
  const callback = new URL(request.redirectUri);
  callback.searchParams.set("code", code);
  return callback;
}

/** Whether the exchange presents the verifier and callback the code is bound to. */
function presentsBinding(
  code: { codeChallenge: string; redirectUri: string },
  input: NativeSignInExchange,
): boolean {
  return (
    code.redirectUri === input.redirectUri &&
    timingSafeEqual(
      Buffer.from(s256(input.codeVerifier)),
      Buffer.from(code.codeChallenge),
    )
  );
}

/**
 * Trades a code for a write token named for the device, or answers null.
 *
 * Any attempt spends the code, a wrong verifier included, so an intercepted
 * code gets one guess. A spent code presented again with its verifier revokes
 * the token it bought (RFC 6749 §4.1.2): two parties holding the verifier
 * means one of them should not have it, and nothing tells which. Without the
 * verifier a replay revokes nothing, so the code alone is no way to sign a
 * device out.
 */
export async function exchangeNativeSignInCode(
  db: Db,
  input: NativeSignInExchange,
) {
  const codeHash = hashCode(input.code);
  const now = new Date();
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(schema.nativeSignInCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(schema.nativeSignInCodes.codeHash, codeHash),
          isNull(schema.nativeSignInCodes.usedAt),
          gt(schema.nativeSignInCodes.expiresAt, now),
        ),
      )
      .returning();

    if (!claimed) {
      const [spent] = await tx
        .select()
        .from(schema.nativeSignInCodes)
        .where(
          and(
            eq(schema.nativeSignInCodes.codeHash, codeHash),
            isNotNull(schema.nativeSignInCodes.usedAt),
          ),
        );
      if (spent?.tokenId && presentsBinding(spent, input)) {
        await tx
          .update(schema.apiTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(schema.apiTokens.id, spent.tokenId),
              isNull(schema.apiTokens.revokedAt),
            ),
          );
      }
      return null;
    }

    if (!presentsBinding(claimed, input)) return null;

    const token = await createApiToken(tx, {
      userId: claimed.userId,
      name: claimed.deviceName,
      scope: "write",
      expiresAt: null,
    });
    await tx
      .update(schema.nativeSignInCodes)
      .set({ tokenId: token.id })
      .where(eq(schema.nativeSignInCodes.codeHash, codeHash));
    return { token: token.token, name: token.name, scope: token.scope };
  });
}
