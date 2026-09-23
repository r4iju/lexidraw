/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const testDir = join(import.meta.dir, "..", "test");

function run(entry: string) {
  const result = Bun.spawnSync({
    cmd: ["bun", join(testDir, entry)],
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("package import graph", () => {
  test("the check notices a react import", () => {
    const { code, stderr } = run("import-react.ts");
    expect(code).toBe(1);
    expect(stderr).toContain("forbidden modules loaded");
    expect(stderr).toContain("/node_modules/react/");
  });

  test("the index loads without react, react-dom, or next", () => {
    const { code, stdout, stderr } = run("import-index.ts");
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("ok:");
  });
});
