/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

/**
 * The words people read, checked in the source because they are spread over
 * every page: a stray "directory" or "Saved!" comes back one component at a
 * time otherwise.
 */
const root = resolve(import.meta.dir, "..");
const sources = await Promise.all(
  (
    await Array.fromAsync(
      new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: root, absolute: true }),
    )
  )
    .filter((file) => !/\.(test|spec)\.|\/test\//.test(file))
    .map(async (file) => ({
      path: relative(root, file),
      source: await readFile(file, "utf8"),
    })),
);

function findAll(pattern: RegExp) {
  const found: string[] = [];
  for (const { path, source } of sources) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      found.push(`${path}:${line}: ${match[0].trim()}`);
    }
  }
  return found;
}

describe("copy", () => {
  test("no toast shouts", () => {
    expect(
      findAll(
        /\btoast(?:\.\w+)?\(\s*(["'`])(?:(?!\1)[^\n])*!(?:(?!\1)[^\n])*\1/g,
      ),
    ).toEqual([]);
  });

  test("the dashboard is called Home", () => {
    expect(
      findAll(
        /["'`>]\s*(?:My [Dd]rawings|Go to (?:my drawings|dashboard))\s*["'`<]|>\s*Root\s*<|title: "Root"/g,
      ),
    ).toEqual([]);
  });

  test("entity types go by the names people use", () => {
    // JSX text only: code keeps the stored type names.
    expect(
      findAll(
        />[^<>{}();=]*\b(?:[Dd]irectory|URL|Articles?|Doc)\b[^<>{}();=]*</g,
      ),
    ).toEqual([]);
  });

  test("toasts say what happened to which file", () => {
    expect(
      findAll(
        /\btoast\.\w+\(\s*(["'`])(?:Saved|Error saving|The title was not saved|Couldn't save)\1/g,
      ),
    ).toEqual([]);
  });

  test("sign-in copy is sentence case", () => {
    expect(
      findAll(/["'`>]\s*(?:Sign In|Sign Out|Sign Up|Log In|Log Out)\s*["'`<]/g),
    ).toEqual([]);
  });
});
