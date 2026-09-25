/// <reference types="bun" />
import { beforeAll, describe, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";
// The signaling server's own check, so the two sides cannot drift apart.
import { verifyRoomToken } from "../../../../signaling-server/src/room-token";

const db = await installServerRuntime();
const { issueRoomToken, ROOM_TOKEN_TTL_MS } = await import(
  "~/server/auth/room-token"
);

const SECRET = "a-secret-long-enough-to-sign-rooms-with";
const OWNER = "rtk_owner";
const EDITOR = "rtk_editor";
const READER = "rtk_reader";
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
    { id: OWNER, name: "Owner", email: "rtk-owner@example.test" },
    { id: EDITOR, name: "Editor", email: "rtk-editor@example.test" },
    { id: READER, name: "Reader", email: "rtk-reader@example.test" },
  ]);
  await db
    .insert(schema.entities)
    .values([
      entity("rtk_private", PublicAccess.PRIVATE),
      entity("rtk_public_read", PublicAccess.READ),
      entity("rtk_public_edit", PublicAccess.EDIT),
    ]);
  await db.insert(schema.sharedEntities).values([
    {
      id: "rtk_s1",
      entityId: "rtk_private",
      userId: EDITOR,
      accessLevel: AccessLevel.EDIT,
    },
    {
      id: "rtk_s2",
      entityId: "rtk_private",
      userId: READER,
      accessLevel: AccessLevel.READ,
    },
  ]);
});

const issue = (
  entityId: string,
  userId: string,
  peer = userId || GUEST,
  mayWrite = true,
) => issueRoomToken(db, { entityId, peer, userId, mayWrite }, SECRET, now);

const claimsOf = (token: string | null) =>
  token === null ? null : verifyRoomToken(SECRET, token, now);

describe("a room token from the app", () => {
  test("is not issued while the app has no secret", async () => {
    const issued = await issueRoomToken(
      db,
      { entityId: "rtk_private", peer: OWNER, userId: OWNER, mayWrite: true },
      undefined,
      now,
    );
    expect(issued).toEqual({ token: null });
  });

  test("opens the entity's room to the caller, for as long as the TTL", async () => {
    const { token } = await issue("rtk_private", OWNER);
    expect(claimsOf(token)).toEqual({
      room: "rtk_private",
      peer: OWNER,
      canEdit: true,
      exp: now + ROOM_TOKEN_TTL_MS,
    });
    expect(verifyRoomToken(SECRET, token ?? "", now + ROOM_TOKEN_TTL_MS)).toBe(
      null,
    );
  });

  test("says whether the caller may edit", async () => {
    const canEdit = async (entityId: string, userId: string, mayWrite = true) =>
      claimsOf((await issue(entityId, userId, undefined, mayWrite)).token)
        ?.canEdit;
    expect(await canEdit("rtk_private", EDITOR)).toBe(true);
    expect(await canEdit("rtk_private", READER)).toBe(false);
    expect(await canEdit("rtk_public_read", "")).toBe(false);
    expect(await canEdit("rtk_public_edit", "")).toBe(true);
    // An API token with read scope reads, even for the owner.
    expect(await canEdit("rtk_private", OWNER, false)).toBe(false);
  });

  test("is not issued for an entity the caller cannot read", async () => {
    await expect(issue("rtk_private", "")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(issue("rtk_missing", OWNER)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("speaks as a guest id, but never as another account", async () => {
    // Before the session loads, a signed-in tab still goes by its guest id.
    expect(claimsOf((await issue("rtk_private", READER, GUEST)).token)).toEqual(
      expect.objectContaining({ peer: GUEST, canEdit: false }),
    );
    await expect(issue("rtk_public_edit", "", OWNER)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(issue("rtk_private", READER, EDITOR)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
