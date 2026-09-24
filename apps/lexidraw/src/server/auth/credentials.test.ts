/// <reference types="bun" />
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq, sql } from "drizzle-orm";
import { legacyPasswordHash } from "~/test/legacy-password-hash";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { authorizeCredentials } = await import("./credentials");
const password = await import("./password");
const { SIGN_IN_LIMITS } = await import("./sign-in-rate-limit");

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

/** Everything `console[level]` printed, as it would appear in the log. */
function captureLog(level: "error" | "warn") {
  const spy = spyOn(console, level).mockImplementation(() => {});
  return () => spy.mock.calls.map((args) => Bun.inspect(args)).join("\n");
}

afterEach(() => {
  mock.restore();
  setSystemTime();
});

describe("credentials sign-in", () => {
  test("a legacy SHA-256 user signs in and is moved to scrypt", async () => {
    const email = await seedUser("cred_legacy", legacyPasswordHash(PASSWORD));

    const user = await authorizeCredentials(email, PASSWORD, null);

    expect(user?.id).toBe("cred_legacy");
    expect(user).not.toHaveProperty("password");
    const upgraded = await storedPassword("cred_legacy");
    expect(upgraded).toStartWith("scrypt$");
    expect((await authorizeCredentials(email, PASSWORD, null))?.id).toBe(
      "cred_legacy",
    );
  });

  test("a wrong password is refused and leaves the stored hash alone", async () => {
    const legacy = legacyPasswordHash(PASSWORD);
    const email = await seedUser("cred_wrong", legacy);

    expect(await authorizeCredentials(email, `${PASSWORD}x`, null)).toBeNull();
    expect(await storedPassword("cred_wrong")).toBe(legacy);
  });

  test("a current scrypt hash is not rewritten on sign-in", async () => {
    const current = await password.hashPassword(PASSWORD);
    const email = await seedUser("cred_current", current);

    expect((await authorizeCredentials(email, PASSWORD, null))?.id).toBe(
      "cred_current",
    );
    expect(await storedPassword("cred_current")).toBe(current);
  });

  test("an unknown email or a password-less user costs a full verify", async () => {
    const passwordless = await seedUser("cred_github", null);
    const verify = spyOn(password, "verifyPassword");

    expect(
      await authorizeCredentials("nobody@example.test", PASSWORD, null),
    ).toBeNull();
    expect(await authorizeCredentials(passwordless, PASSWORD, null)).toBeNull();

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
    captureLog("error");

    expect((await authorizeCredentials(email, PASSWORD, null))?.id).toBe(
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
    const logged = captureLog("error");

    expect((await authorizeCredentials(email, PASSWORD, null))?.id).toBe(
      "cred_db_fail",
    );
    expect(await storedPassword("cred_db_fail")).toBe(legacy);
    expect(logged()).toContain("cred_db_fail");
    expect(logged()).not.toContain(legacy);
    expect(logged()).not.toContain("scrypt$");
  });
});

describe("credentials sign-in rate limit", () => {
  beforeEach(() => {
    setSystemTime(Date.UTC(2029, 0, 1));
  });

  test("past the per-email limit even the right password is refused before scrypt, logged by code only", async () => {
    const email = await seedUser(
      "cred_limit_email",
      await password.hashPassword(PASSWORD),
    );
    const verify = spyOn(password, "verifyPassword").mockResolvedValue(false);
    const logged = captureLog("warn");
    const spellings = [email, email.toUpperCase(), `  ${email} `];

    for (let i = 0; i < SIGN_IN_LIMITS.email.max; i++) {
      const spelling = spellings[i % spellings.length] as string;
      await authorizeCredentials(spelling, `${PASSWORD}x`, `198.51.100.${i}`);
    }
    expect(verify).toHaveBeenCalledTimes(SIGN_IN_LIMITS.email.max);
    verify.mockRestore();
    const verifyAfter = spyOn(password, "verifyPassword");

    expect(
      await authorizeCredentials(email, PASSWORD, "198.51.100.250"),
    ).toBeNull();
    expect(verifyAfter).not.toHaveBeenCalled();
    expect(logged()).toContain("RATE_LIMITED");
    expect(logged()).not.toContain("cred_limit_email");
    expect(logged()).not.toContain("198.51.100");
  });

  test("past the per-IP limit every email from that IP is refused before scrypt, other IPs are not", async () => {
    const verify = spyOn(password, "verifyPassword").mockResolvedValue(false);
    const logged = captureLog("warn");
    const ip = "203.0.113.7";

    for (let i = 0; i < SIGN_IN_LIMITS.ip.max; i++) {
      await authorizeCredentials(`limit_ip_${i}@example.test`, PASSWORD, ip);
    }
    expect(verify).toHaveBeenCalledTimes(SIGN_IN_LIMITS.ip.max);

    const fresh = "limit_ip_fresh@example.test";
    expect(await authorizeCredentials(fresh, PASSWORD, ip)).toBeNull();
    expect(verify).toHaveBeenCalledTimes(SIGN_IN_LIMITS.ip.max);
    expect(logged()).toContain("RATE_LIMITED");
    expect(logged()).not.toContain(ip);

    await authorizeCredentials(fresh, PASSWORD, "203.0.113.8");
    expect(verify).toHaveBeenCalledTimes(SIGN_IN_LIMITS.ip.max + 1);
  });

  test("the next window lets attempts through again", async () => {
    const verify = spyOn(password, "verifyPassword").mockResolvedValue(false);
    captureLog("warn");
    const email = "limit_window@example.test";
    const start = Date.UTC(2030, 0, 1);

    setSystemTime(start);
    for (let i = 0; i <= SIGN_IN_LIMITS.email.max; i++) {
      await authorizeCredentials(email, PASSWORD, null);
    }
    expect(verify).toHaveBeenCalledTimes(SIGN_IN_LIMITS.email.max);

    setSystemTime(start + SIGN_IN_LIMITS.windowMs);
    await authorizeCredentials(email, PASSWORD, null);
    expect(verify).toHaveBeenCalledTimes(SIGN_IN_LIMITS.email.max + 1);
  });
});
