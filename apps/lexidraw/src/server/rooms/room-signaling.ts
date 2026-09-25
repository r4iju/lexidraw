import {
  and,
  asc,
  type drizzle,
  eq,
  gt,
  isNull,
  lt,
  ne,
  or,
  schema,
} from "@packages/drizzle";
import { AccessLevel, PublicAccess, type WebRtcMessage } from "@packages/types";
import { TRPCError } from "@trpc/server";
import { findReadableFacts } from "~/server/entities/readable";

type Db = typeof drizzle;

/**
 * How long a peer stays in a room without its signal stream checking in.
 * The stream checks in well inside this, and reconnects well inside it too.
 */
export const ROOM_PEER_TTL_MS = 30_000;

/**
 * How long a signal is kept. A peer only reads signals that arrived since it
 * last heard from the room, which is seconds ago while it is connected.
 */
export const ROOM_SIGNAL_TTL_MS = 10 * 60_000;

/** Signals handed to a peer at a time; the next read carries on after them. */
const SIGNAL_PAGE = 100;

/** A peer the app has let into an entity's room, and whether it may edit. */
export type RoomMember = { entityId: string; peer: string; canEdit: boolean };

export type DirectedSignal =
  | { type: "offer"; to: string; payload: string }
  | { type: "answer"; to: string; payload: string }
  | { type: "iceCandidate"; to: string; payload: string };

/**
 * Lets the caller into `entityId`'s room as `peer` if they can read it, and
 * says whether they may edit. Every message they send is stamped with that.
 *
 * `peer` is the caller's own user id, or a guest id, which is what a tab uses
 * before its session loads and what an anonymous reader always uses. It is
 * never another account's id. `mayWrite` is false for an API token with read
 * scope.
 */
export async function admitToRoom(
  db: Db,
  input: { entityId: string; peer: string; userId: string; mayWrite: boolean },
): Promise<RoomMember> {
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
        message: "A peer goes by the caller's id or a guest id",
      });
    }
  }

  const canEdit =
    input.mayWrite &&
    ((input.userId !== "" && entity.ownerId === input.userId) ||
      entity.sharedAccessLevel === AccessLevel.EDIT ||
      entity.publicAccess === PublicAccess.EDIT);

  return { entityId: entity.id, peer: input.peer, canEdit };
}

/**
 * Puts `member` in the room, or keeps it there, and returns the signal id it
 * reads on from. A peer entering afresh is announced and reads only what
 * comes after; one resuming after `resumeAfter` carries on from there, and is
 * announced again only if the room had given it up for gone.
 */
export async function enterRoom(
  db: Db,
  member: RoomMember,
  resumeAfter: number | null,
  now: number,
): Promise<number> {
  const seen = { lastSeen: new Date(now), canEdit: member.canEdit };
  const stayed = await db
    .update(schema.roomPeers)
    .set(seen)
    .where(
      and(
        eq(schema.roomPeers.entityId, member.entityId),
        eq(schema.roomPeers.peer, member.peer),
      ),
    )
    .returning({ peer: schema.roomPeers.peer });
  if (resumeAfter !== null && stayed.length > 0) return resumeAfter;

  if (stayed.length === 0) {
    await db
      .insert(schema.roomPeers)
      .values({ entityId: member.entityId, peer: member.peer, ...seen })
      .onConflictDoUpdate({
        target: [schema.roomPeers.entityId, schema.roomPeers.peer],
        set: seen,
      });
  }
  const [join] = await db
    .insert(schema.roomSignals)
    .values({
      entityId: member.entityId,
      fromPeer: member.peer,
      type: "join",
      canEdit: member.canEdit,
      createdAt: new Date(now),
    })
    .returning({ id: schema.roomSignals.id });
  if (!join) throw new Error("A join was not recorded");
  return resumeAfter ?? join.id;
}

/** What `member` has not yet heard from the room since signal `after`. */
export async function signalsFor(
  db: Db,
  member: RoomMember,
  after: number,
): Promise<{ id: number; message: WebRtcMessage }[]> {
  const signals = schema.roomSignals;
  const rows = await db
    .select()
    .from(signals)
    .where(
      and(
        eq(signals.entityId, member.entityId),
        gt(signals.id, after),
        ne(signals.fromPeer, member.peer),
        or(isNull(signals.toPeer), eq(signals.toPeer, member.peer)),
      ),
    )
    .orderBy(asc(signals.id))
    .limit(SIGNAL_PAGE);
  return rows.map((row) => ({ id: row.id, message: toMessage(row) }));
}

export async function sendSignal(
  db: Db,
  member: RoomMember,
  signal: DirectedSignal,
  now: number,
) {
  await db.insert(schema.roomSignals).values({
    entityId: member.entityId,
    fromPeer: member.peer,
    toPeer: signal.to,
    type: signal.type,
    payload: signal.payload,
    canEdit: member.canEdit,
    createdAt: new Date(now),
  });
}

/** Takes `member` out of the room, announcing it unless it was already out. */
export async function leaveRoom(db: Db, member: RoomMember, now: number) {
  const left = await db
    .delete(schema.roomPeers)
    .where(
      and(
        eq(schema.roomPeers.entityId, member.entityId),
        eq(schema.roomPeers.peer, member.peer),
      ),
    )
    .returning();
  await announceLeaving(db, left, now);
}

/**
 * Gives up for gone the peers in `entityId`'s room that stopped checking in,
 * and announces each once: of two streams sweeping at the same moment, only
 * the one whose delete took the row announces it.
 */
export async function sweepRoom(db: Db, entityId: string, now: number) {
  const gone = await db
    .delete(schema.roomPeers)
    .where(
      and(
        eq(schema.roomPeers.entityId, entityId),
        lt(schema.roomPeers.lastSeen, new Date(now - ROOM_PEER_TTL_MS)),
      ),
    )
    .returning();
  await announceLeaving(db, gone, now);
}

/**
 * Drops signals older than anyone could still be reading from, and peers
 * from rooms where no one was left to sweep them.
 */
export async function purgeRoomSignals(db: Db, now: number) {
  const before = new Date(now - ROOM_SIGNAL_TTL_MS);
  await db
    .delete(schema.roomSignals)
    .where(lt(schema.roomSignals.createdAt, before));
  await db
    .delete(schema.roomPeers)
    .where(lt(schema.roomPeers.lastSeen, before));
}

async function announceLeaving(
  db: Db,
  peers: (typeof schema.roomPeers.$inferSelect)[],
  now: number,
) {
  if (peers.length === 0) return;
  await db.insert(schema.roomSignals).values(
    peers.map((peer) => ({
      entityId: peer.entityId,
      fromPeer: peer.peer,
      type: "leave" as const,
      canEdit: peer.canEdit,
      createdAt: new Date(now),
    })),
  );
}

function toMessage(row: typeof schema.roomSignals.$inferSelect): WebRtcMessage {
  const from = { room: row.entityId, from: row.fromPeer, canEdit: row.canEdit };
  const to = row.toPeer ?? "";
  const payload = row.payload ?? "";
  switch (row.type) {
    case "join":
    case "leave":
      return { ...from, type: row.type };
    case "offer":
      return { ...from, type: "offer", to, offer: payload };
    case "answer":
      return { ...from, type: "answer", to, answer: payload };
    case "iceCandidate":
      return { ...from, type: "iceCandidate", to, candidate: payload };
    default:
      throw new Error(`Unknown signal type: ${row.type satisfies never}`);
  }
}
