/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { randomBytes, scryptSync } from "node:crypto";
import { legacyPasswordHash } from "~/test/legacy-password-hash";
import { hashPassword, needsRehash, verifyPassword } from "./password";

const PASSWORD = "Correct-Horse-Battery-9!";

/** A genuine scrypt hash of `password` in the stored format, at any cost. */
function scryptHash(
  password: string,
  { N, r, p }: { N: number; r: number; p: number },
  keyBytes = 32,
) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, keyBytes, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

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
    const stored = legacyPasswordHash(PASSWORD);

    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}x`, stored)).toBe(false);
    expect(needsRehash(stored)).toBe(true);
  });

  test("verifies a scrypt hash made with weaker parameters and marks it for rehash", async () => {
    const weaker = scryptHash(PASSWORD, { N: 2 ** 10, r: 8, p: 1 });

    expect(await verifyPassword(PASSWORD, weaker)).toBe(true);
    expect(needsRehash(weaker)).toBe(true);
  });

  test("refuses parameters above today's and keys of another length", async () => {
    for (const stored of [
      scryptHash(PASSWORD, { N: 2 ** 18, r: 2, p: 1 }),
      scryptHash(PASSWORD, { N: 2 ** 10, r: 16, p: 1 }),
      scryptHash(PASSWORD, { N: 2 ** 10, r: 8, p: 2 }),
      scryptHash(PASSWORD, { N: 2 ** 10, r: 8, p: 1 }, 16),
    ]) {
      expect(await verifyPassword(PASSWORD, stored)).toBe(false);
    }
  });

  test("refuses stored values it cannot read instead of throwing", async () => {
    for (const stored of [
      "",
      PASSWORD,
      legacyPasswordHash(PASSWORD).toUpperCase(),
      "scrypt$131072$8$1$salt",
      "scrypt$abc$8$1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaA",
    ]) {
      expect(await verifyPassword(PASSWORD, stored)).toBe(false);
    }
  });
});
