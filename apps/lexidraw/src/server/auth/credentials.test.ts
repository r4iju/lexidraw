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
const rateLimit = await import("./sign-in-rate-limit");
const { SIGN_IN_LIMITS } = rateLimit;

const signIn = (email: string, password: string, ip: string | null) =>
  authorizeCredentials({ email, password }, ip);

const PASSWORD = "Correct-Horse-Battery-9!";

async function seedUser(
  id: string,
  stored: string | null,
  email = `${id}@example.test`,
) {
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

    const user = await signIn(email, PASSWORD, null);

    expect(user?.id).toBe("cred_legacy");
    expect(user).not.toHaveProperty("password");
    const upgraded = await storedPassword("cred_legacy");
    expect(upgraded).toStartWith("scrypt$");
    expect((await signIn(email, PASSWORD, null))?.id).toBe("cred_legacy");
  });

  test("a wrong password is refused and leaves the stored hash alone", async () => {
    const legacy = legacyPasswordHash(PASSWORD);
    const email = await seedUser("cred_wrong", legacy);

    expect(await signIn(email, `${PASSWORD}x`, null)).toBeNull();
    expect(await storedPassword("cred_wrong")).toBe(legacy);
  });

  test("a current scrypt hash is not rewritten on sign-in", async () => {
    const current = await password.hashPassword(PASSWORD);
    const email = await seedUser("cred_current", current);

    expect((await signIn(email, PASSWORD, null))?.id).toBe("cred_current");
    expect(await storedPassword("cred_current")).toBe(current);
  });

  test("an unknown email or a password-less user costs a full verify", async () => {
    const passwordless = await seedUser("cred_github", null);
    const verify = spyOn(password, "verifyPassword");

    expect(await signIn("nobody@example.test", PASSWORD, null)).toBeNull();
    expect(await signIn(passwordless, PASSWORD, null)).toBeNull();

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

    expect((await signIn(email, PASSWORD, null))?.id).toBe("cred_hash_fail");
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

    expect((await signIn(email, PASSWORD, null))?.id).toBe("cred_db_fail");
    expect(await storedPassword("cred_db_fail")).toBe(legacy);
    expect(logged()).toContain("cred_db_fail");
    expect(logged()).not.toContain(legacy);
    expect(logged()).not.toContain("scrypt$");
  });
});

describe("credentials input", () => {
  test("an email signs in whatever its case or spacing, including an address stored mixed-case", async () => {
    const hash = await password.hashPassword(PASSWORD);
    const lower = await seedUser("cred_case_lower", hash);
    await seedUser("cred_case_mixed", hash, "Cred.Case.Mixed@Example.TEST");

    expect(
      (await signIn(`  ${lower.toUpperCase()} `, PASSWORD, null))?.id,
    ).toBe("cred_case_lower");
    expect(
      (await signIn(" cred.case.mixed@example.test", PASSWORD, null))?.id,
    ).toBe("cred_case_mixed");
  });

  test("blank, malformed or missing credentials fail like a wrong password", async () => {
    for (const credentials of [
      {},
      { email: "", password: "" },
      { email: "", password: PASSWORD },
      { email: "someone@example.test", password: "" },
      { email: "not-an-email", password: PASSWORD },
      { email: ["someone@example.test"], password: PASSWORD },
    ]) {
      expect(await authorizeCredentials(credentials, null)).toBeNull();
    }
  });
});

describe("credentials sign-in rate limit", () => {
  beforeEach(() => {
    setSystemTime(Date.UTC(2029, 0, 1));
  });

  async function seedSignedUp(id: string) {
    return seedUser(id, await password.hashPassword(PASSWORD));
  }

  test("10 failures from one client refuse that client before scrypt, while the right password from another client signs in", async () => {
    const email = await seedSignedUp("cred_lockout");
    const logged = captureLog("warn");
    const stranger = "198.51.100.66";
    const spellings = [email, email.toUpperCase(), `  ${email} `];

    const verify = spyOn(password, "verifyPassword").mockResolvedValue(false);
    for (let i = 0; i < 10; i++) {
      const spelling = spellings[i % spellings.length] as string;
      expect(await signIn(spelling, `${PASSWORD}x`, stranger)).toBeNull();
    }
    expect(verify).toHaveBeenCalledTimes(10);
    verify.mockRestore();
    const verifyAfter = spyOn(password, "verifyPassword");

    expect(await signIn(email, PASSWORD, stranger)).toBeNull();
    expect(verifyAfter).not.toHaveBeenCalled();
    expect(logged()).toContain("RATE_LIMITED");
    expect(logged()).not.toContain("cred_lockout");
    expect(logged()).not.toContain("198.51.100");

    expect((await signIn(email, PASSWORD, "198.51.100.67"))?.id).toBe(
      "cred_lockout",
    );
  });

  test("100 failures for one email across clients refuse it from every client before scrypt", async () => {
    const email = await seedSignedUp("cred_backstop");
    captureLog("warn");
    const verify = spyOn(password, "verifyPassword").mockResolvedValue(false);

    for (let i = 0; i < 100; i++) {
      await signIn(email, `${PASSWORD}x`, `192.0.2.${i}`);
    }
    expect(verify).toHaveBeenCalledTimes(100);
    verify.mockRestore();
    const verifyAfter = spyOn(password, "verifyPassword");

    expect(await signIn(email, PASSWORD, "192.0.2.250")).toBeNull();
    expect(verifyAfter).not.toHaveBeenCalled();
  });

  test("successful sign-ins count toward no email limit and clear that client's failures", async () => {
    const email = await seedSignedUp("cred_success");
    const ip = "198.51.100.200";
    const verify = spyOn(password, "verifyPassword");

    verify.mockResolvedValue(true);
    for (let i = 0; i < 11; i++) {
      expect((await signIn(email, PASSWORD, `198.51.100.${i}`))?.id).toBe(
        "cred_success",
      );
    }
    for (let round = 0; round < 2; round++) {
      verify.mockResolvedValue(false);
      for (let i = 0; i < 9; i++) await signIn(email, `${PASSWORD}x`, ip);
      verify.mockResolvedValue(true);
      expect((await signIn(email, PASSWORD, ip))?.id).toBe("cred_success");
    }
  });

  test("30 attempts from one client refuse every email from it before scrypt, other clients are not", async () => {
    const verify = spyOn(password, "verifyPassword").mockResolvedValue(false);
    const logged = captureLog("warn");
    const ip = "203.0.113.7";

    for (let i = 0; i < 30; i++) {
      await signIn(`limit_ip_${i}@example.test`, PASSWORD, ip);
    }
    expect(verify).toHaveBeenCalledTimes(30);

    const fresh = "limit_ip_fresh@example.test";
    expect(await signIn(fresh, PASSWORD, ip)).toBeNull();
    expect(verify).toHaveBeenCalledTimes(30);
    expect(logged()).toContain("RATE_LIMITED");
    expect(logged()).not.toContain(ip);

    await signIn(fresh, PASSWORD, "203.0.113.8");
    expect(verify).toHaveBeenCalledTimes(31);
  });

  test("a limiter whose store fails lets sign-in through, logged by code only", async () => {
    const email = await seedSignedUp("cred_limit_down");
    const logged = captureLog("error");
    await db.run(
      sql.raw(`ALTER TABLE "SignInAttempts" RENAME TO "SignInAttemptsAway"`),
    );
    try {
      expect(await signIn(email, `${PASSWORD}x`, "192.0.2.1")).toBeNull();
      expect((await signIn(email, PASSWORD, "192.0.2.1"))?.id).toBe(
        "cred_limit_down",
      );
    } finally {
      await db.run(
        sql.raw(`ALTER TABLE "SignInAttemptsAway" RENAME TO "SignInAttempts"`),
      );
    }
    expect(logged()).toContain("[Auth]");
    expect(logged()).not.toContain("cred_limit_down");
    expect(logged()).not.toContain("192.0.2.1");
  });

  test("the next window lets attempts through again", async () => {
    const verify = spyOn(password, "verifyPassword").mockResolvedValue(false);
    captureLog("warn");
    const email = "limit_window@example.test";
    const start = Date.UTC(2030, 0, 1);

    setSystemTime(start);
    for (let i = 0; i <= 10; i++) {
      await signIn(email, PASSWORD, null);
    }
    expect(verify).toHaveBeenCalledTimes(10);

    setSystemTime(start + SIGN_IN_LIMITS.windowMs);
    await signIn(email, PASSWORD, null);
    expect(verify).toHaveBeenCalledTimes(11);
  });
});
