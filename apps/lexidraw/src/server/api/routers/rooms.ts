import { tracked } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import type { RequestAuth } from "~/server/auth/api-token-format";
import {
  admitToRoom,
  enterRoom,
  leaveRoom,
  sendSignal,
  signalsFor,
  sweepRoom,
} from "~/server/rooms/room-signaling";

/** How often a signal stream looks for new signals. */
const POLL_MS = 1_000;
/** How often a signal stream checks its peer in, well inside the peer TTL. */
const CHECK_IN_MS = 10_000;

const room = z.object({
  entityId: z.string().min(1),
  peer: z.string().min(1).max(128),
});

/**
 * Live editing's signaling: peers with an entity open find each other here
 * and trade what WebRTC needs to connect them, after which their edits travel
 * peer to peer. Everything goes through the caller's own session, so only
 * people who can read the entity get in, and every message carries whether
 * its sender may edit.
 */
export const roomsRouter = createTRPCRouter({
  /**
   * What the room says to the caller, as it happens. The stream ends every
   * few minutes, at `sse.maxDurationMs`, and the client picks it up again from
   * the last signal it heard, still in the room.
   */
  signals: publicProcedure
    .input(room.extend({ lastEventId: z.string().nullish() }))
    .subscription(async function* ({ input, ctx, signal }) {
      const db = ctx.drizzle;
      const member = await admitToRoom(db, admission(input, ctx));
      let cursor = await enterRoom(
        db,
        member,
        cursorFrom(input.lastEventId),
        Date.now(),
      );
      let checkedIn = Date.now();
      while (!signal?.aborted) {
        for (const { id, message } of await signalsFor(db, member, cursor)) {
          cursor = id;
          yield tracked(String(id), message);
        }
        if (Date.now() - checkedIn >= CHECK_IN_MS) {
          checkedIn = Date.now();
          cursor = await enterRoom(db, member, cursor, checkedIn);
          await sweepRoom(db, member.entityId, checkedIn);
        }
        await pause(POLL_MS, signal);
      }
    }),
  /** An offer, answer or ICE candidate for one other peer in the room. */
  signal: publicProcedure
    .input(
      room.extend({
        to: z.string().min(1).max(128),
        type: z.enum(["offer", "answer", "iceCandidate"]),
        payload: z.string().max(64_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const member = await admitToRoom(ctx.drizzle, admission(input, ctx));
      await sendSignal(
        ctx.drizzle,
        member,
        { type: input.type, to: input.to, payload: input.payload },
        Date.now(),
      );
    }),
  leave: publicProcedure.input(room).mutation(async ({ input, ctx }) => {
    const member = await admitToRoom(ctx.drizzle, admission(input, ctx));
    await leaveRoom(ctx.drizzle, member, Date.now());
  }),
});

function admission(
  input: z.infer<typeof room>,
  ctx: { session: { user?: { id?: string } } | null; auth?: RequestAuth },
) {
  return {
    entityId: input.entityId,
    peer: input.peer,
    userId: ctx.session?.user?.id ?? "",
    mayWrite: ctx.auth?.kind !== "token" || ctx.auth.scope === "write",
  };
}

function cursorFrom(lastEventId: string | null | undefined) {
  const cursor = Number(lastEventId);
  return lastEventId && Number.isSafeInteger(cursor) ? cursor : null;
}

function pause(ms: number, signal: AbortSignal | undefined) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
