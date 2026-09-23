import { describe, expect, it } from "bun:test";

import { PROFILES, resolveProfile } from "../src/profile";

describe("resolveProfile", () => {
  it("defaults to prod", () => {
    expect(resolveProfile(undefined, {})).toEqual({
      name: "prod",
      baseUrl: PROFILES.prod,
    });
  });

  it("reads LEXIDRAW_PROFILE", () => {
    expect(resolveProfile(undefined, { LEXIDRAW_PROFILE: "dev" })).toEqual({
      name: "dev",
      baseUrl: PROFILES.dev,
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
});
