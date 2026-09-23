import { describe, expect, it } from "bun:test";

import { originKey, PROFILES, resolveProfile } from "../src/profile";

describe("resolveProfile", () => {
  it("defaults to prod", () => {
    expect(resolveProfile(undefined, {})).toMatchObject({
      name: "prod",
      baseUrl: PROFILES.prod,
      origin: "https://lexidraw.app",
      keychainAllowed: true,
    });
  });

  it("reads LEXIDRAW_PROFILE", () => {
    expect(
      resolveProfile(undefined, { LEXIDRAW_PROFILE: "dev" }),
    ).toMatchObject({
      name: "dev",
      baseUrl: PROFILES.dev,
      keychainAllowed: true,
    });
  });

  it("lets the flag win over the environment", () => {
    expect(resolveProfile("prod", { LEXIDRAW_PROFILE: "dev" }).name).toBe(
      "prod",
    );
  });

  it("lets LEXIDRAW_URL override the base URL", () => {
    expect(
      resolveProfile("dev", { LEXIDRAW_URL: "http://localhost:3028/" }).baseUrl,
    ).toBe("http://localhost:3028");
  });

  it("rejects an unknown profile with the known ones", () => {
    expect(() => resolveProfile("staging", {})).toThrow(
      expect.objectContaining({
        code: "USAGE",
        details: { known: ["prod", "dev"] },
      }) as unknown as Error,
    );
  });

  it("rejects a base URL that is not a URL", () => {
    expect(() =>
      resolveProfile("dev", { LEXIDRAW_URL: "localhost:3000" }),
    ).toThrow(expect.objectContaining({ code: "USAGE" }) as unknown as Error);
  });

  it("rejects a base URL that is not http", () => {
    expect(() =>
      resolveProfile("dev", { LEXIDRAW_URL: "file:///etc/passwd" }),
    ).toThrow(expect.objectContaining({ code: "USAGE" }) as unknown as Error);
  });
});

describe("keychainAllowed", () => {
  it("is on for a profile pointed at its own host", () => {
    expect(
      resolveProfile("prod", { LEXIDRAW_URL: "https://lexidraw.app/" })
        .keychainAllowed,
    ).toBe(true);
  });

  it("is off when prod is pointed somewhere else", () => {
    expect(
      resolveProfile("prod", { LEXIDRAW_URL: "http://evil.test" })
        .keychainAllowed,
    ).toBe(false);
  });

  it("is on for a dev server on any loopback port", () => {
    for (const url of [
      "http://localhost:3999",
      "http://127.0.0.1:3028",
      "http://[::1]:3028",
    ]) {
      expect(resolveProfile("dev", { LEXIDRAW_URL: url })).toMatchObject({
        keychainAllowed: true,
      });
    }
  });

  it("is off for a dev profile pointed off the machine", () => {
    expect(
      resolveProfile("dev", { LEXIDRAW_URL: "http://192.168.1.5:3000" })
        .keychainAllowed,
    ).toBe(false);
  });
});

describe("originKey", () => {
  it("is a directory-safe, unambiguous form of the origin", () => {
    expect(originKey("https://lexidraw.app")).toBe("https-lexidraw.app");
    expect(originKey("http://localhost:3028")).toBe("http-localhost-3028");
    expect(originKey("http://evil.test")).not.toBe(
      originKey("https://evil.test"),
    );
  });
});
