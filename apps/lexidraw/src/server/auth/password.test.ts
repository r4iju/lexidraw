/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { hashPassword, needsRehash, verifyPassword } from "./password";

const PASSWORD = "Correct-Horse-Battery-9!";

/** A stored value as sign-up wrote it before passwords were salted. */
const legacyHash = (password: string) =>
  createHash("sha256").update(password).digest("hex");

describe("password hashing", () => {
  test("stores a salted, self-describing scrypt hash that verifies", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);

    expect(a).toMatch(/^scrypt\$131072\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, a)).toBe(false);
    expect(needsRehash(a)).toBe(false);
  });

  test("verifies an unsalted SHA-256 hex digest and marks it for rehash", async () => {
    const stored = legacyHash(PASSWORD);

    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, stored)).toBe(false);
    expect(needsRehash(stored)).toBe(true);
  });

  test("marks a scrypt hash made with weaker parameters for rehash", async () => {
    const weaker = (await hashPassword(PASSWORD)).replace(
      "scrypt$131072$",
      "scrypt$16384$",
    );
    expect(needsRehash(weaker)).toBe(true);
  });

  test("refuses stored values it cannot read instead of throwing", async () => {
    for (const stored of [
      "",
      PASSWORD,
      legacyHash(PASSWORD).toUpperCase(),
      "scrypt$131072$8$1$salt",
      "scrypt$abc$8$1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA",
    ]) {
      expect(await verifyPassword(PASSWORD, stored)).toBe(false);
    }
  });
});
