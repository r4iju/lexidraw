import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * What the app vouches for when it hands a peer a room token: which room the
 * peer may join, the id it will speak as there, whether it may edit, and when
 * the token stops being accepted (milliseconds since the epoch).
 *
 * The app signs these and the signaling server checks them, with a secret
 * both hold. The codec has no dependencies so either side can import it.
 */
export type RoomTokenClaims = {
  room: string;
  peer: string;
  canEdit: boolean;
  exp: number;
};

const SCOPE = "lexidraw-signaling-room";

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret)
    .update(`${SCOPE}.${payload}`)
    .digest("base64url");
}

export function signRoomToken(secret: string, claims: RoomTokenClaims) {
  const payload = Buffer.from(
    JSON.stringify({
      room: claims.room,
      peer: claims.peer,
      canEdit: claims.canEdit,
      exp: claims.exp,
    }),
  ).toString("base64url");
  return `${payload}.${signature(secret, payload)}`;
}

/** The token's claims, or null unless it is well formed, signed with this secret and unexpired. */
export function verifyRoomToken(
  secret: string,
  token: string,
  now = Date.now(),
): RoomTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, presented] = parts as [string, string];
  if (!payload || !presented) return null;

  const expected = Buffer.from(signature(secret, payload));
  const given = Buffer.from(presented);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isClaims(claims) || claims.exp <= now) return null;
  return {
    room: claims.room,
    peer: claims.peer,
    canEdit: claims.canEdit,
    exp: claims.exp,
  };
}

function isClaims(value: unknown): value is RoomTokenClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.room === "string" &&
    typeof claims.peer === "string" &&
    typeof claims.canEdit === "boolean" &&
    typeof claims.exp === "number"
  );
}
