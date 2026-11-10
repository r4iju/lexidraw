/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";

await installServerRuntime();
const { AUTH_PAGES, hostAndPages } = await import("./create-auth");

describe("hostAndPages", () => {
  test("production without TRUST_HOST keeps Lexidraw's own pages", () => {
    const options = hostAndPages({ isDev: false, trustHost: false });
    expect(options.pages).toEqual({
      signIn: "/signin",
      signOut: "/signout",
      error: "/signin-error",
    });
    // Host trust is left to Auth.js, as before.
    expect("trustHost" in options).toBe(false);
  });

  test("TRUST_HOST or dev only flips trust to true", () => {
    expect(hostAndPages({ isDev: false, trustHost: true })).toEqual({
      trustHost: true,
      pages: { ...AUTH_PAGES },
    });
    expect(hostAndPages({ isDev: true, trustHost: false })).toEqual({
      trustHost: true,
      pages: { ...AUTH_PAGES },
    });
  });
});
