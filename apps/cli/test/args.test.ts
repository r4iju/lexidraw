import { describe, expect, it } from "bun:test";

import { one, parseArgs, rejectExtra } from "../src/args";
import { takeGlobals } from "../src/cli";
import { CliError } from "../src/errors";

const SPEC = { value: ["json", "query"], boolean: ["list"] } as const;

describe("parseArgs", () => {
  it("keeps positionals in order", () => {
    const args = parseArgs(["GET", "/entities/1"], SPEC);
    expect(args.positionals).toEqual(["GET", "/entities/1"]);
  });

  it("reads a value flag as --name value and --name=value", () => {
    expect(parseArgs(["--json", "{}"], SPEC).values.json).toEqual(["{}"]);
    expect(parseArgs(["--json={}"], SPEC).values.json).toEqual(["{}"]);
  });

  it("collects a repeated value flag", () => {
    const args = parseArgs(["--query", "a=1", "--query", "b=2"], SPEC);
    expect(args.values.query).toEqual(["a=1", "b=2"]);
  });

  it("records boolean flags", () => {
    expect(parseArgs(["--list"], SPEC).booleans.has("list")).toBe(true);
  });

  it("treats everything after -- as positional", () => {
    expect(parseArgs(["--", "--json"], SPEC).positionals).toEqual(["--json"]);
  });

  it("rejects an unknown flag as a usage error", () => {
    expect(() => parseArgs(["--nope"], SPEC)).toThrow(
      expect.objectContaining({ code: "USAGE" }) as unknown as Error,
    );
  });

  it("rejects a value flag with no value", () => {
    expect(() => parseArgs(["--json"], SPEC)).toThrow("--json needs a value");
  });

  it("rejects a value on a boolean flag", () => {
    expect(() => parseArgs(["--list=1"], SPEC)).toThrow(
      "--list does not take a value",
    );
  });
});

describe("one", () => {
  it("returns the single value", () => {
    expect(one(parseArgs(["--json", "1"], SPEC), "json")).toBe("1");
  });

  it("is undefined when the flag is absent", () => {
    expect(one(parseArgs([], SPEC), "json")).toBeUndefined();
  });

  it("rejects a repeat", () => {
    const args = parseArgs(["--json", "1", "--json", "2"], SPEC);
    expect(() => one(args, "json")).toThrow("--json was given more than once");
  });
});

describe("rejectExtra", () => {
  it("names the first argument past the expected count", () => {
    expect(() => rejectExtra(parseArgs(["a", "b"], SPEC), 1)).toThrow(
      'unexpected argument "b"',
    );
  });
});

describe("takeGlobals", () => {
  it("pulls global flags out from anywhere", () => {
    const globals = takeGlobals([
      "schema",
      "--profile",
      "dev",
      "doc get",
      "--refresh",
    ]);
    expect(globals).toMatchObject({ profile: "dev", refresh: true });
    expect(globals.rest).toEqual(["schema", "doc get"]);
  });

  it("accepts --profile=value", () => {
    expect(takeGlobals(["--profile=dev"]).profile).toBe("dev");
  });

  it("leaves a command flag's value alone", () => {
    const globals = takeGlobals(["api", "POST", "/e", "--json", "--refresh"]);
    expect(globals.refresh).toBe(false);
    expect(globals.rest).toEqual(["api", "POST", "/e", "--json", "--refresh"]);
  });

  it("rejects --profile with no value", () => {
    expect(() => takeGlobals(["--profile"])).toThrow(CliError);
  });
});
