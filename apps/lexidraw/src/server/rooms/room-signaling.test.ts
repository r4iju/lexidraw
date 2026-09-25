/// <reference types="bun" />
import { beforeAll, describe, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const {
  admitToRoom,
  enterRoom,
  signalsFor,
  sendSignal,
  leaveRoom,
  sweepRoom,
  purgeRoomSignals,
  ROOM_PEER_TTL_MS,
  ROOM_SIGNAL_TTL_MS,
} = await import("~/server/rooms/room-signaling");

const OWNER = "rs_owner";
const EDITOR = "rs_editor";
const READER = "rs_reader";
const GUEST = "0a1b2c3d4e5f6071";
const now = Date.UTC(2026, 8, 1);
const at = new Date(now);

const entity = (id: string, publicAccess: PublicAccess) => ({
  id,
  title: id,
  elements: "{}",
  entityType: "document",
  userId: OWNER,
  publicAccess,
  createdAt: at,
  updatedAt: at,
});

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "rs-owner@example.test" },
    { id: EDITOR, name: "Editor", email: "rs-editor@example.test" },
    { id: READER, name: "Reader", email: "rs-reader@example.test" },
  ]);
  await db
    .insert(schema.entities)
    .values([
      entity("rs_private", PublicAccess.PRIVATE),
      entity("rs_public_read", PublicAccess.READ),
      entity("rs_public_edit", PublicAccess.EDIT),
      ...["rs_join", "rs_signal", "rs_resume", "rs_quiet", "rs_leave"].map(
        (id) => entity(id, PublicAccess.PRIVATE),
      ),
    ]);
  const shares = (entityId: string) => [
    {
      id: `${entityId}_editor`,
      entityId,
      userId: EDITOR,
      accessLevel: AccessLevel.EDIT,
    },
    {
      id: `${entityId}_reader`,
      entityId,
      userId: READER,
      accessLevel: AccessLevel.READ,
    },
  ];
  await db
    .insert(schema.sharedEntities)
    .values(
      [
        "rs_private",
        "rs_join",
        "rs_signal",
        "rs_resume",
        "rs_quiet",
        "rs_leave",
      ].flatMap(shares),
    );
});

const admit = (
  entityId: string,
  userId: string,
  peer = userId || GUEST,
  mayWrite = true,
) => admitToRoom(db, { entityId, peer, userId, mayWrite });

/** Admits `userId` and enters the room fresh, as a page that just opened. */
async function arrive(entityId: string, userId: string, time = now) {
  const member = await admit(entityId, userId);
  const cursor = await enterRoom(db, member, null, time);
  return { member, cursor };
}

const heard = async (
  arrival: Awaited<ReturnType<typeof arrive>>,
  after = arrival.cursor,
) =>
  (await signalsFor(db, arrival.member, after)).map(({ message }) => message);

describe("being let into an entity's room", () => {
  test("says whether the peer may edit", async () => {
    const canEdit = async (entityId: string, userId: string, mayWrite = true) =>
      (await admit(entityId, userId, undefined, mayWrite)).canEdit;
    expect(await canEdit("rs_private", OWNER)).toBe(true);
    expect(await canEdit("rs_private", EDITOR)).toBe(true);
    expect(await canEdit("rs_private", READER)).toBe(false);
    expect(await canEdit("rs_public_read", "")).toBe(false);
    expect(await canEdit("rs_public_edit", "")).toBe(true);
    // An API token with read scope reads, even for the owner.
    expect(await canEdit("rs_private", OWNER, false)).toBe(false);
  });

  test("is refused for an entity the caller cannot read", async () => {
    await expect(admit("rs_private", "")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(admit("rs_missing", OWNER)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("goes by a guest id, but never by another account's", async () => {
    // Before the session loads, a signed-in tab still goes by its guest id.
    expect(await admit("rs_private", READER, GUEST)).toEqual({
      entityId: "rs_private",
      peer: GUEST,
      canEdit: false,
    });
    await expect(admit("rs_public_edit", "", OWNER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admit("rs_private", READER, EDITOR)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("a room", () => {
  test("announces a newcomer, with its access, to those already there, and tells the newcomer nothing from before", async () => {
    const owner = await arrive("rs_join", OWNER);
    const reader = await arrive("rs_join", READER);
    expect(await heard(owner)).toEqual([
      { type: "join", room: "rs_join", from: READER, canEdit: false },
    ]);
    expect(await heard(reader)).toEqual([]);
  });

  test("passes a signal only to the peer it is for, with the sender's access", async () => {
    const owner = await arrive("rs_signal", OWNER);
    const editor = await arrive("rs_signal", EDITOR);
    const reader = await arrive("rs_signal", READER);
    await sendSignal(
      db,
      reader.member,
      { type: "offer", to: OWNER, payload: "the-offer" },
      now,
    );
    expect(await heard(owner)).toContainEqual({
      type: "offer",
      room: "rs_signal",
      from: READER,
      to: OWNER,
      offer: "the-offer",
      canEdit: false,
    });
    expect(await heard(editor)).toEqual([
      { type: "join", room: "rs_signal", from: READER, canEdit: false },
    ]);
  });

  test("does not announce again a peer that picks up where it left off", async () => {
    const owner = await arrive("rs_resume", OWNER);
    const reader = await arrive("rs_resume", READER);
    await enterRoom(db, reader.member, reader.cursor, now + 1_000);
    expect(await heard(owner)).toEqual([
      { type: "join", room: "rs_resume", from: READER, canEdit: false },
    ]);
  });

  test("announces once that a quiet peer has gone, and again when it is back", async () => {
    const owner = await arrive("rs_quiet", OWNER);
    const reader = await arrive("rs_quiet", READER);
    const later = now + ROOM_PEER_TTL_MS / 2;
    await enterRoom(db, owner.member, owner.cursor, later);
    const past = now + ROOM_PEER_TTL_MS + 1;
    await sweepRoom(db, "rs_quiet", past);
    await sweepRoom(db, "rs_quiet", past);
    await enterRoom(db, reader.member, reader.cursor, past + 1);
    expect(await heard(owner)).toEqual([
      { type: "join", room: "rs_quiet", from: READER, canEdit: false },
      { type: "leave", room: "rs_quiet", from: READER, canEdit: false },
      { type: "join", room: "rs_quiet", from: READER, canEdit: false },
    ]);
  });

  test("announces once that a peer has left", async () => {
    const owner = await arrive("rs_leave", OWNER);
    const editor = await arrive("rs_leave", EDITOR);
    await leaveRoom(db, editor.member, now);
    await leaveRoom(db, editor.member, now);
    expect(await heard(owner)).toEqual([
      { type: "join", room: "rs_leave", from: EDITOR, canEdit: true },
      { type: "leave", room: "rs_leave", from: EDITOR, canEdit: true },
    ]);
  });

  test("forgets signals, and peers, once no one could still be waiting on them", async () => {
    const owner = await arrive("rs_join", OWNER);
    await sendSignal(
      db,
      owner.member,
      { type: "offer", to: READER, payload: "stale" },
      now,
    );
    await purgeRoomSignals(db, now + ROOM_SIGNAL_TTL_MS - 1);
    expect(await db.select().from(schema.roomSignals)).not.toEqual([]);
    await purgeRoomSignals(db, now + 60 * 60_000);
    expect(await db.select().from(schema.roomSignals)).toEqual([]);
    expect(await db.select().from(schema.roomPeers)).toEqual([]);
  });
});
