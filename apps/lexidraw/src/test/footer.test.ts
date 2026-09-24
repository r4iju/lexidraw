/// <reference types="bun" />
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const app = resolve(import.meta.dir, "../app");

test("the footer is only on marketing, sign-in and legal pages", async () => {
  const withFooter: string[] = [];
  for await (const file of new Bun.Glob("**/*.tsx").scan({
    cwd: app,
    absolute: true,
  })) {
    if (/\.test\.tsx$/.test(file)) continue;
    const source = await readFile(file, "utf8");
    if (/from "~\/sections\/(?:footer|marketing-frame)"/.test(source))
      withFooter.push(relative(app, file));
  }
  expect(withFooter.sort()).toEqual([
    "page.tsx",
    "privacy-policy/layout.tsx",
    "signin/layout.tsx",
    "signup/layout.tsx",
    "terms-of-service/layout.tsx",
  ]);
});
