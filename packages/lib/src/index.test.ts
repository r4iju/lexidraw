/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

// The barrel must stay importable with no environment configured; env-dependent
// helpers are reachable only through their subpaths (@packages/lib/blob, /turso).
function importInCleanEnv(specifier: string) {
  return Bun.spawnSync({
    cmd: [process.execPath, "-e", `await import(${JSON.stringify(specifier)})`],
    cwd: import.meta.dir,
    env: { PATH: process.env.PATH ?? "" },
    stderr: "pipe",
    stdout: "pipe",
  });
}

describe("@packages/lib barrel", () => {
  test("imports without any environment variables", () => {
    const result = importInCleanEnv("./index.ts");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("env-dependent subpaths still validate the environment", () => {
    const result = importInCleanEnv("./blob.ts");
    expect(result.exitCode).not.toBe(0);
  });
});
