/// <reference types="bun" />
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq, sql } from "drizzle-orm";
import { legacyPasswordHash } from "~/test/legacy-password-hash";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { authorizeCredentials } = await import("./credentials");
const password = await import("./password");

const PASSWORD = "Correct-Horse-Battery-9!";

async function seedUser(id: string, stored: string | null) {
  const email = `${id}@example.test`;
  await db
    .insert(schema.users)
    .values({ id, name: id, email, password: stored });
  return email;
}

async function storedPassword(id: string) {
  const [row] = await db
    .select({ password: schema.users.password })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  return row?.password;
}

/** Everything `console.error` printed, as it would appear in the log. */
function captureErrors() {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  return () => spy.mock.calls.map((args) => Bun.inspect(args)).join("\n");
}

afterEach(() => {
  mock.restore();
});

describe("credentials sign-in", () => {
  test("a legacy SHA-256 user signs in and is moved to scrypt", async () => {
    const email = await seedUser("cred_legacy", legacyPasswordHash(PASSWORD));

    const user = await authorizeCredentials(email, PASSWORD);

    expect(user?.id).toBe("cred_legacy");
    expect(user).not.toHaveProperty("password");
    const upgraded = await storedPassword("cred_legacy");
    expect(upgraded).toStartWith("scrypt$");
    expect((await authorizeCredentials(email, PASSWORD))?.id).toBe(
      "cred_legacy",
    );
  });

  test("a wrong password is refused and leaves the stored hash alone", async () => {
    const legacy = legacyPasswordHash(PASSWORD);
    const email = await seedUser("cred_wrong", legacy);

    expect(await authorizeCredentials(email, `${PASSWORD}x`)).toBeNull();
    expect(await storedPassword("cred_wrong")).toBe(legacy);
  });

  test("a current scrypt hash is not rewritten on sign-in", async () => {
    const current = await password.hashPassword(PASSWORD);
    const email = await seedUser("cred_current", current);

    expect((await authorizeCredentials(email, PASSWORD))?.id).toBe(
      "cred_current",
    );
    expect(await storedPassword("cred_current")).toBe(current);
  });

  test("an unknown email or a password-less user costs a full verify", async () => {
    const passwordless = await seedUser("cred_github", null);
    const verify = spyOn(password, "verifyPassword");

    expect(
      await authorizeCredentials("nobody@example.test", PASSWORD),
    ).toBeNull();
    expect(await authorizeCredentials(passwordless, PASSWORD)).toBeNull();

    expect(verify).toHaveBeenCalledTimes(2);
    for (const [, stored] of verify.mock.calls) {
      expect(password.needsRehash(stored)).toBe(false);
    }
  });

  test("a rehash that cannot be computed still signs the user in", async () => {
    const legacy = legacyPasswordHash(PASSWORD);
    const email = await seedUser("cred_hash_fail", legacy);
    spyOn(password, "hashPassword").mockRejectedValue(
      new Error("Cannot allocate memory"),
    );
    captureErrors();

    expect((await authorizeCredentials(email, PASSWORD))?.id).toBe(
      "cred_hash_fail",
    );
    expect(await storedPassword("cred_hash_fail")).toBe(legacy);
  });

  test("a rehash the database refuses signs the user in and logs no hash", async () => {
    const legacy = legacyPasswordHash(PASSWORD);
    const email = await seedUser("cred_db_fail", legacy);
    await db.run(
      sql.raw(`CREATE TRIGGER cred_db_fail BEFORE UPDATE OF password ON "Users"
        WHEN OLD.id = 'cred_db_fail'
        BEGIN SELECT RAISE(ABORT, 'refused'); END`),
    );
    const logged = captureErrors();

    expect((await authorizeCredentials(email, PASSWORD))?.id).toBe(
      "cred_db_fail",
    );
    expect(await storedPassword("cred_db_fail")).toBe(legacy);
    expect(logged()).toContain("cred_db_fail");
    expect(logged()).not.toContain(legacy);
    expect(logged()).not.toContain("scrypt$");
  });
});
