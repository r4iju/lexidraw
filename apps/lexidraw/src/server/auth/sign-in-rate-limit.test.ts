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
  takeSignInAttempt,
} = await import("./sign-in-rate-limit");

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

  test("IPv6 addresses in one /64 share the IP limit, however they are spelled", async () => {
    setSystemTime(Date.UTC(2032, 0, 1));
    const spellings = (i: number) => [
      `2001:db8:1:2::${(i + 1).toString(16)}`,
      `2001:0DB8:0001:0002:0:0:0:${(i + 1).toString(16)}`,
      `2001:db8:1:2:${(i + 1).toString(16)}::`,
    ];

    for (let i = 0; i < SIGN_IN_LIMITS.ip.max; i++) {
      const ip = spellings(i)[i % 3] as string;
      expect(await takeSignInAttempt(`v6_${i}@example.test`, ip)).toBeNull();
    }

    const next = "v6_next@example.test";
    expect(
      await takeSignInAttempt(next, "2001:db8:1:2:ffff:ffff:ffff:ffff"),
    ).toBe("ip");
    expect(await takeSignInAttempt(next, "2001:db8:1:3::1")).toBeNull();
  });

  test("the purge drops finished windows and keeps the current one counting", async () => {
    const start = Date.UTC(2031, 0, 1);
    setSystemTime(start);
    await takeSignInAttempt("purge_old@example.test", "192.0.2.1");

    const now = start + SIGN_IN_LIMITS.windowMs;
    setSystemTime(now);
    for (let i = 0; i < SIGN_IN_LIMITS.email.max; i++) {
      await takeSignInAttempt("purge_live@example.test", null);
    }

    await purgeExpiredSignInAttempts();

    const finished = await db
      .select()
      .from(schema.signInAttempts)
      .where(lt(schema.signInAttempts.windowStart, new Date(now)));
    expect(finished).toEqual([]);
    expect(await takeSignInAttempt("purge_live@example.test", null)).toBe(
      "email",
    );
  });
});
