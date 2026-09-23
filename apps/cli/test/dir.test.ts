import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { run } from "../src/cli";
import { type EntityStub, startEntityStub, TOKEN } from "./entity-stub";
import { fakeIo } from "./helpers";

let stub: EntityStub;

beforeEach(() => {
  stub = startEntityStub([
    { id: "dir-notes", title: "Notes", entityType: "directory" },
    {
      id: "dir-sub",
      title: "Sub",
      entityType: "directory",
      parentId: "dir-notes",
    },
    {
      id: "doc-plan",
      title: "Plan",
      entityType: "document",
      parentId: "dir-notes",
    },
  ]);
});

afterEach(() => {
  stub.stop();
});

function io() {
  return fakeIo({
    env: {
      LEXIDRAW_PROFILE: "dev",
      LEXIDRAW_URL: stub.baseUrl,
      LEXIDRAW_TOKEN: TOKEN,
    },
  });
}

describe("dir list", () => {
  it("lists every child of a directory, whatever its type", async () => {
    const out = io();
    expect(await run(["dir", "list", "dir-notes"], out.io)).toBe(0);
    expect(
      JSON.parse(out.stdout())
        .map((row: { id: string }) => row.id)
        .sort(),
    ).toEqual(["dir-sub", "doc-plan"]);
  });

  it("lists the root when unaddressed", async () => {
    const out = io();
    expect(await run(["dir", "list"], out.io)).toBe(0);
    expect(
      JSON.parse(out.stdout()).map((row: { id: string }) => row.id),
    ).toEqual(["dir-notes"]);
  });

  it("carries parentId in the table", async () => {
    const out = io();
    expect(
      await run(
        ["dir", "list", "--path", "Notes", "--format", "table"],
        out.io,
      ),
    ).toBe(0);
    const lines = out.stdout().trimEnd().split("\n");
    expect(lines[0]).toContain("parentId");
    expect(lines.at(-1)).toEndWith("dir-notes");
  });

  it("refuses --page-all with an explicit --format", async () => {
    const out = io();
    expect(
      await run(["dir", "list", "--page-all", "--format", "json"], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).code).toBe("USAGE");
  });

  it("streams NDJSON for --page-all", async () => {
    const out = io();
    expect(await run(["dir", "list", "dir-notes", "--page-all"], out.io)).toBe(
      0,
    );
    const rows = out
      .stdout()
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string });
    expect(rows.map((row) => row.id).sort()).toEqual(["dir-sub", "doc-plan"]);
  });
});

describe("dir create", () => {
  it("creates a directory under a resolved parent", async () => {
    const out = io();
    expect(
      await run(
        ["dir", "create", "--title", "Fresh", "--dir-path", "Notes"],
        out.io,
      ),
    ).toBe(0);
    const created = JSON.parse(out.stdout());
    expect(stub.rows.get(created.id)).toMatchObject({
      title: "Fresh",
      entityType: "directory",
      parentId: "dir-notes",
    });
  });

  it("creates at the root without --dir", async () => {
    const out = io();
    expect(await run(["dir", "create", "--title", "Top"], out.io)).toBe(0);
    expect(stub.rows.get(JSON.parse(out.stdout()).id)?.parentId).toBeNull();
  });

  it("needs a title", async () => {
    const out = io();
    expect(await run(["dir", "create"], out.io)).toBe(2);
    expect(JSON.parse(out.stderr()).message).toContain("--title");
  });

  it("rejects a verb it does not have", async () => {
    const out = io();
    expect(await run(["dir", "delete", "dir-notes"], out.io)).toBe(2);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "USAGE",
      known: ["list", "create"],
    });
  });
});

describe("search", () => {
  it("prints the matches as JSON", async () => {
    const out = io();
    expect(await run(["search", "Plan"], out.io)).toBe(0);
    expect(
      JSON.parse(out.stdout()).map((row: { id: string }) => row.id),
    ).toEqual(["doc-plan"]);
  });

  it("renders the matches as a table", async () => {
    const out = io();
    expect(await run(["search", "Notes", "--format", "table"], out.io)).toBe(0);
    expect(out.stdout()).toBe(
      `id         title  type       updatedAt\ndir-notes  Notes  directory  ${stub.rows.get("dir-notes")?.updatedAt}\n`,
    );
  });

  it("needs a query", async () => {
    const out = io();
    expect(await run(["search"], out.io)).toBe(2);
    expect(JSON.parse(out.stderr()).code).toBe("USAGE");
  });
});
