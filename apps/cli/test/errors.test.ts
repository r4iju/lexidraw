import { describe, expect, it } from "bun:test";

import { CliError, exitCodeOf, formatError, usageError } from "../src/errors";

describe("formatError", () => {
  it("puts code and message first and merges the details", () => {
    const error = new CliError("UNAUTHORIZED", "nope", {
      details: { status: 401, issues: [{ message: "bad" }] },
    });
    expect(JSON.parse(formatError(error))).toEqual({
      code: "UNAUTHORIZED",
      message: "nope",
      status: 401,
      issues: [{ message: "bad" }],
    });
    expect(Object.keys(JSON.parse(formatError(error)))).toEqual([
      "code",
      "message",
      "status",
      "issues",
    ]);
  });

  it("gives an unexpected throw a code as well", () => {
    expect(JSON.parse(formatError(new TypeError("boom")))).toEqual({
      code: "INTERNAL",
      message: "boom",
    });
  });
});

describe("exitCodeOf", () => {
  it("is 2 for usage errors and 1 otherwise", () => {
    expect(exitCodeOf(usageError("bad"))).toBe(2);
    expect(exitCodeOf(new CliError("NETWORK", "down"))).toBe(1);
    expect(exitCodeOf(new Error("boom"))).toBe(1);
  });
});
