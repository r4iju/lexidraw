/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  API_TOKEN_PREFIX,
  generateApiToken,
  hashApiToken,
  readBearerApiToken,
  tokenMayRun,
} from "./api-token-format";

describe("api token format", () => {
  test("generated tokens are prefixed, unique, and never stored as-is", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashApiToken(a)).toHaveLength(64);
    expect(hashApiToken(a)).toBe(hashApiToken(a));
    expect(hashApiToken(a)).not.toBe(hashApiToken(b));
  });

  test("reads only our bearer tokens from the Authorization header", () => {
    const token = generateApiToken();
    expect(
      readBearerApiToken(new Headers({ authorization: `Bearer ${token}` })),
    ).toBe(token);
    expect(
      readBearerApiToken(new Headers({ Authorization: `bearer ${token}` })),
    ).toBe(token);
    expect(
      readBearerApiToken(new Headers({ authorization: "Bearer ghp_other" })),
    ).toBeNull();
    expect(
      readBearerApiToken(new Headers({ authorization: token })),
    ).toBeNull();
    expect(readBearerApiToken(new Headers())).toBeNull();
  });

  test("scope gates mutations only", () => {
    const read = { kind: "token", tokenId: "t", scope: "read" } as const;
    const write = { kind: "token", tokenId: "t", scope: "write" } as const;
    expect(tokenMayRun(read, "query")).toBe(true);
    expect(tokenMayRun(read, "mutation")).toBe(false);
    expect(tokenMayRun(write, "mutation")).toBe(true);
    expect(tokenMayRun({ kind: "session" }, "mutation")).toBe(true);
    expect(tokenMayRun(undefined, "mutation")).toBe(true);
  });
});
