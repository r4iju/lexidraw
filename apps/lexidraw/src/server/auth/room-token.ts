import crypto from "node:crypto";
import { type drizzle, eq, schema } from "@packages/drizzle";
import { AccessLevel, PublicAccess } from "@packages/types";
import { TRPCError } from "@trpc/server";
import { findReadableFacts } from "~/server/entities/readable";

type Db = typeof drizzle;

/**
 * Long enough to connect, and to reconnect after a short drop; a client asks
 * for a fresh one each time it connects. The server checks it once, when the
 * connection opens, so a session outlives it.
 */
export const ROOM_TOKEN_TTL_MS = 10 * 60_000;

/**
 * The signaling server's room token, which lets a peer into one entity's room
 * under one id, and tells the room whether that peer may edit. The format is
 * the one `apps/signaling-server/src/room-token.ts` checks, and the tests
 * verify one with the other.
 */
type RoomTokenClaims = {
  room: string;
  peer: string;
  canEdit: boolean;
  exp: number;
};

const SCOPE = "lexidraw-signaling-room";

function signRoomToken(secret: string, claims: RoomTokenClaims) {
  const payload = Buffer.from(
    JSON.stringify({
      room: claims.room,
      peer: claims.peer,
      canEdit: claims.canEdit,
      exp: claims.exp,
    }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${SCOPE}.${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * A room token for `entityId`, or null when the app has no secret, in which
 * case the client connects without one, as it always has.
 *
 * `peer` is the id the client goes by in the room: the caller's own user id,
 * or a guest id, which is what a tab uses before its session loads and what
 * an anonymous reader always uses. It is never another account's id.
 * `mayWrite` is false for an API token with read scope.
 */
export async function issueRoomToken(
  db: Db,
  input: { entityId: string; peer: string; userId: string; mayWrite: boolean },
  secret: string | undefined,
  now = Date.now(),
): Promise<{ token: string | null }> {
  if (!secret) return { token: null };

  const entity = await findReadableFacts(db, input.entityId, input.userId);
  if (!entity) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No entity "${input.entityId}"`,
    });
  }

  if (input.peer !== input.userId) {
    const [account] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, input.peer))
      .limit(1);
    if (account) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "A room token names the caller or a guest id",
      });
    }
  }

  const canEdit =
    input.mayWrite &&
    ((input.userId !== "" && entity.ownerId === input.userId) ||
      entity.sharedAccessLevel === AccessLevel.EDIT ||
      entity.publicAccess === PublicAccess.EDIT);

  return {
    token: signRoomToken(secret, {
      room: entity.id,
      peer: input.peer,
      canEdit,
      exp: now + ROOM_TOKEN_TTL_MS,
    }),
  };
}
