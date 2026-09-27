import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COPIED_FROM } from "../tables";

test("tables.ts copies the @lexical/table the reference runs", () => {
  const entry = Bun.resolveSync("@lexical/table", import.meta.dir);
  const manifest = JSON.parse(
    readFileSync(join(dirname(entry), "..", "package.json"), "utf8"),
  ) as { name: string; version: string };
  expect(`${manifest.name}@${manifest.version}`).toBe(COPIED_FROM);
});
