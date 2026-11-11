/// <reference types="bun" />
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { lt } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const {
  SIGN_IN_LIMITS,
  clientIp,
  purgeExpiredSignInAttempts,
  withSignInLimit,
} = await import("./sign-in-rate-limit");

/** Whether an attempt got past the limits to its password check. */
async function checked(email: string, ip: string | null, signsIn = false) {
  let ran = false;
  await withSignInLimit(email, ip, async () => {
    ran = true;
    return signsIn ? {} : null;
  });
  return ran;
}

afterEach(() => {
  setSystemTime();
});

describe("sign-in rate limit", () => {
  test("the client IP is the first x-forwarded-for hop, else x-real-ip, else unknown", () => {
    expect(
      clientIp(
        new Headers({
          "x-forwarded-for": " 203.0.113.1 , 10.0.0.1",
          "x-real-ip": "10.0.0.2",
        }),
      ),
    ).toBe("203.0.113.1");
    expect(clientIp(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe(
      "2001:db8::1",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": " , " }))).toBeNull();
    expect(clientIp(new Headers())).toBeNull();
  });

  test("IPv6 addresses in one /64 share the client limit, however they are spelled", async () => {
    setSystemTime(Date.UTC(2032, 0, 1));
    const spellings = (i: number) => [
      `2001:db8:1:2::${(i + 1).toString(16)}`,
      `2001:0DB8:0001:0002:0:0:0:${(i + 1).toString(16)}`,
      `2001:db8:1:2:${(i + 1).toString(16)}::`,
    ];

    for (let i = 0; i < 30; i++) {
      const ip = spellings(i)[i % 3] as string;
      expect(await checked(`v6_${i}@example.test`, ip, true)).toBe(true);
    }

    const next = "v6_next@example.test";
    expect(await checked(next, "2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(false);
    expect(await checked(next, "2001:db8:1:3::1")).toBe(true);
  });

  test("attempts sent at once cannot check more passwords than the limit allows", async () => {
    setSystemTime(Date.UTC(2033, 0, 1));
    const email = "race@example.test";
    const ip = "198.51.100.7";
    const { maxFailures } = SIGN_IN_LIMITS.emailAndClient;
    for (let i = 0; i < maxFailures - 1; i++)
      expect(await checked(email, ip)).toBe(true);

    let checks = 0;
    const slowWrongPassword = async () => {
      checks++;
      await Bun.sleep(20);
      return null;
    };
    await Promise.all(
      Array.from({ length: 15 }, () =>
        withSignInLimit(email, ip, slowWrongPassword),
      ),
    );
    expect(checks).toBe(1);
  });

  test("the purge drops finished windows and keeps the current one counting", async () => {
    const start = Date.UTC(2031, 0, 1);
    setSystemTime(start);
    await checked("purge_old@example.test", "192.0.2.1");

    const now = start + SIGN_IN_LIMITS.windowMs;
    setSystemTime(now);
    for (let i = 0; i < 10; i++) {
      await checked("purge_live@example.test", null);
    }

    await purgeExpiredSignInAttempts();

    const finished = await db
      .select()
      .from(schema.signInAttempts)
      .where(lt(schema.signInAttempts.windowStart, new Date(now)));
    expect(finished).toEqual([]);
    expect(await checked("purge_live@example.test", null)).toBe(false);
  });
});
