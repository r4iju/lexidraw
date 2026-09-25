import { describe, expect, test } from "vitest";
import { signRoomToken, verifyRoomToken } from "../src/room-token.js";

const SECRET = "a-secret-long-enough-to-sign-rooms-with";
const claims = {
  room: "room-a",
  peer: "user-1",
  canEdit: false,
  exp: Date.now() + 60_000,
};

describe("a room token", () => {
  test("carries the room, the peer and whether they may edit", () => {
    const token = signRoomToken(SECRET, claims);
    expect(verifyRoomToken(SECRET, token)).toEqual(claims);
  });

  test("is refused once it has expired", () => {
    const token = signRoomToken(SECRET, { ...claims, exp: Date.now() - 1 });
    expect(verifyRoomToken(SECRET, token)).toBeNull();
  });

  test("is refused when signed with another secret", () => {
    const token = signRoomToken(
      "some-other-secret-of-the-same-length!!",
      claims,
    );
    expect(verifyRoomToken(SECRET, token)).toBeNull();
  });

  test("is refused when its claims were changed after signing", () => {
    const [, signature] = signRoomToken(SECRET, claims).split(".");
    const edited = Buffer.from(
      JSON.stringify({ ...claims, canEdit: true }),
    ).toString("base64url");
    expect(verifyRoomToken(SECRET, `${edited}.${signature}`)).toBeNull();
  });

  test("is refused when it is not a token at all", () => {
    for (const token of ["", "garbage", "a.b.c", "."]) {
      expect(verifyRoomToken(SECRET, token)).toBeNull();
    }
  });
});
