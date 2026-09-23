import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProfile } from "../src/profile";
import {
  createKeychainStore,
  requireToken,
  resolveToken,
  type TokenStore,
} from "../src/tokens";
import { writeShim } from "./helpers";

const dev = resolveProfile("dev", {});
const prodElsewhere = resolveProfile("prod", {
  LEXIDRAW_URL: "http://evil.test",
});

function store(entries: Record<string, string>): TokenStore & {
  lookups: string[];
} {
  const map = new Map(Object.entries(entries));
  const lookups: string[] = [];
  return {
    lookups,
    get: (account) => {
      lookups.push(account);
      return map.get(account) ?? null;
    },
    set: (account, token) => {
      map.set(account, token);
    },
  };
}

describe("resolveToken", () => {
  it("prefers the environment over the keychain", () => {
    expect(
      resolveToken(
        dev,
        { LEXIDRAW_TOKEN: "lxd_env" },
        store({ dev: "lxd_kc" }),
      ),
    ).toEqual({ token: "lxd_env", source: "env" });
  });

  it("falls back to the keychain entry for the profile", () => {
    expect(resolveToken(dev, {}, store({ dev: "lxd_kc" }))).toEqual({
      token: "lxd_kc",
      source: "keychain",
    });
  });

  it("does not read another profile's entry", () => {
    expect(
      resolveToken(resolveProfile("prod", {}), {}, store({ dev: "lxd_kc" })),
    ).toEqual({ token: null, source: "none" });
  });

  it("never touches the keychain for a foreign origin", () => {
    const kc = store({ prod: "lxd_kc" });
    expect(resolveToken(prodElsewhere, {}, kc)).toEqual({
      token: null,
      source: "none",
    });
    expect(kc.lookups).toEqual([]);
  });

  it("still uses the environment for a foreign origin", () => {
    expect(
      resolveToken(prodElsewhere, { LEXIDRAW_TOKEN: "lxd_env" }, store({})),
    ).toEqual({ token: "lxd_env", source: "env" });
  });

  it("ignores an empty environment variable", () => {
    expect(resolveToken(dev, { LEXIDRAW_TOKEN: "  " }, store({})).source).toBe(
      "none",
    );
  });
});

describe("requireToken", () => {
  it("fails with NO_TOKEN and exit 1", () => {
    expect(() => requireToken(dev, {}, store({}))).toThrow(
      expect.objectContaining({
        code: "NO_TOKEN",
        exitCode: 1,
      }) as unknown as Error,
    );
  });

  it("explains the origin rule when that is why there is no token", () => {
    expect(() => requireToken(prodElsewhere, {}, store({}))).toThrow(
      /not its own host/,
    );
  });
});

describe("createKeychainStore", () => {
  it("reads the password `security` prints", async () => {
    const shim = await writeShim('printf "lxd_from_shim\\n"');
    expect(createKeychainStore(shim).get("dev")).toBe("lxd_from_shim");
  });

  it("treats exit 44 as no such entry", async () => {
    const shim = await writeShim("exit 44");
    expect(createKeychainStore(shim).get("dev")).toBeNull();
  });

  it("reports any other failure instead of pretending there is no token", async () => {
    const shim = await writeShim(
      'echo "User canceled the operation." >&2; exit 51',
    );
    expect(() => createKeychainStore(shim).get("dev")).toThrow(
      expect.objectContaining({
        code: "KEYCHAIN_UNAVAILABLE",
      }) as unknown as Error,
    );
    expect(() => createKeychainStore(shim).get("dev")).toThrow(/User canceled/);
  });

  it("reports a missing security binary", () => {
    expect(() =>
      createKeychainStore("/nonexistent/security").get("dev"),
    ).toThrow(
      expect.objectContaining({
        code: "KEYCHAIN_UNAVAILABLE",
      }) as unknown as Error,
    );
  });

  it("keeps the token off argv and feeds it to `security -i`", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lexidraw-kc-"));
    const argvFile = join(dir, "argv");
    const stdinFile = join(dir, "stdin");
    const shim = await writeShim(
      `printf "%s\\n" "$@" > ${argvFile}; cat > ${stdinFile}`,
    );

    createKeychainStore(shim).set("dev", "lxd_secret");

    const argv = await Bun.file(argvFile).text();
    expect(argv.trim()).toBe("-i");
    expect(argv).not.toContain("lxd_secret");
    expect(await Bun.file(stdinFile).text()).toBe(
      'add-generic-password -U -s cli/lexidraw -a "dev" -w "lxd_secret"\n',
    );
  });

  it("raises when storing fails", async () => {
    const shim = await writeShim('echo "nope" >&2; exit 1');
    expect(() => createKeychainStore(shim).set("dev", "lxd_secret")).toThrow(
      expect.objectContaining({ code: "KEYCHAIN" }) as unknown as Error,
    );
  });
});
