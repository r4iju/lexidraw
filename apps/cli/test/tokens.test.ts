import { describe, expect, it } from "bun:test";

import { requireToken, resolveToken, type TokenStore } from "../src/tokens";

function store(entries: Record<string, string>): TokenStore {
  const map = new Map(Object.entries(entries));
  return {
    get: (account) => map.get(account) ?? null,
    set: (account, token) => {
      map.set(account, token);
    },
  };
}

describe("resolveToken", () => {
  it("prefers the environment over the keychain", () => {
    const resolved = resolveToken(
      "dev",
      { LEXIDRAW_TOKEN: "lxd_env" },
      store({ dev: "lxd_stored" }),
    );
    expect(resolved).toEqual({ token: "lxd_env", source: "env" });
  });

  it("falls back to the keychain entry for the profile", () => {
    expect(resolveToken("dev", {}, store({ dev: "lxd_stored" }))).toEqual({
      token: "lxd_stored",
      source: "keychain",
    });
  });

  it("does not read another profile's entry", () => {
    expect(resolveToken("prod", {}, store({ dev: "lxd_stored" }))).toEqual({
      token: null,
      source: "none",
    });
  });

  it("ignores an empty environment variable", () => {
    expect(
      resolveToken("dev", { LEXIDRAW_TOKEN: "  " }, store({})).source,
    ).toBe("none");
  });
});

describe("requireToken", () => {
  it("fails with NO_TOKEN and exit 1", () => {
    try {
      requireToken("prod", {}, store({}));
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toMatchObject({ code: "NO_TOKEN", exitCode: 1 });
    }
  });
});
