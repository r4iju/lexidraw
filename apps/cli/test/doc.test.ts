import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/cli";
import { type EntityStub, startEntityStub, TOKEN } from "./entity-stub";
import { fakeIo } from "./helpers";

let stub: EntityStub;

beforeEach(() => {
  stub = startEntityStub([
    { id: "dir-notes", title: "Notes", entityType: "directory" },
    {
      id: "doc-plan",
      title: "Plan",
      entityType: "document",
      parentId: "dir-notes",
      blocks: ["# Plan", "The body."],
    },
    { id: "doc-root", title: "Root note", entityType: "document" },
  ]);
});

afterEach(() => {
  stub.stop();
});

function io(stdin?: string) {
  return fakeIo({
    env: {
      LEXIDRAW_PROFILE: "dev",
      LEXIDRAW_URL: stub.baseUrl,
      LEXIDRAW_TOKEN: TOKEN,
    },
    stdin,
  });
}

const revision = (id: string) => stub.rows.get(id)?.updatedAt as string;

describe("doc list", () => {
  it("lists the documents of a directory as JSON", async () => {
    const out = io();
    expect(await run(["doc", "list", "--dir-path", "Notes"], out.io)).toBe(0);
    expect(
      JSON.parse(out.stdout()).map((row: { id: string }) => row.id),
    ).toEqual(["doc-plan"]);
  });

  it("lists the root when no directory is given", async () => {
    const out = io();
    expect(await run(["doc", "list"], out.io)).toBe(0);
    expect(
      JSON.parse(out.stdout()).map((row: { id: string }) => row.id),
    ).toEqual(["doc-root"]);
  });

  it("renders a table with padded columns", async () => {
    const out = io();
    expect(await run(["doc", "list", "--format", "table"], out.io)).toBe(0);
    const [header, first] = out.stdout().split("\n");
    expect(header).toStartWith("id        title      type      updatedAt");
    expect(first).toStartWith("doc-root  Root note  document  2026-");
  });

  it("streams one JSON object per line for --page-all", async () => {
    const out = io();
    expect(
      await run(["doc", "list", "--dir-path", "Notes", "--page-all"], out.io),
    ).toBe(0);
    const lines = out.stdout().trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string).id).toBe("doc-plan");
  });

  it("refuses --page-all with any --format, json included", async () => {
    for (const format of ["table", "json"]) {
      const out = io();
      expect(
        await run(["doc", "list", "--page-all", "--format", format], out.io),
      ).toBe(2);
      expect(JSON.parse(out.stderr()).code).toBe("USAGE");
    }
  });
});

describe("doc get", () => {
  it("prints markdown with frontmatter by default", async () => {
    const out = io();
    expect(await run(["doc", "get", "--path", "Notes/Plan"], out.io)).toBe(0);
    expect(out.stdout()).toBe(
      "---\nid: doc-plan\ntitle: Plan\n---\n\n# Plan\n\nThe body.\n",
    );
  });

  it("drops the frontmatter for --format raw", async () => {
    const out = io();
    expect(
      await run(["doc", "get", "doc-plan", "--format", "raw"], out.io),
    ).toBe(0);
    expect(out.stdout()).toBe("# Plan\n\nThe body.\n");
  });

  it("prints the editor state for --format json", async () => {
    const out = io();
    expect(
      await run(["doc", "get", "doc-plan", "--format", "json"], out.io),
    ).toBe(0);
    expect(JSON.parse(out.stdout()).content).toEqual({
      root: { children: [] },
    });
  });

  it("rejects a format it cannot render", async () => {
    const out = io();
    expect(
      await run(["doc", "get", "doc-plan", "--format", "yaml"], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).code).toBe("USAGE");
  });
});

describe("doc create", () => {
  it("creates an empty document in a directory", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "create", "--title", "Fresh", "--dir-path", "Notes"],
        out.io,
      ),
    ).toBe(0);
    const created = JSON.parse(out.stdout());
    expect(stub.rows.get(created.id)).toMatchObject({
      title: "Fresh",
      entityType: "document",
      parentId: "dir-notes",
      blocks: [],
    });
  });

  it("replaces the empty paragraph with the body, and reports that revision", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "create", "--title", "Fresh", "--text", "# Fresh\n\nHello."],
        out.io,
      ),
    ).toBe(0);
    const created = JSON.parse(out.stdout());
    const row = stub.rows.get(created.id);
    expect(row?.blocks).toEqual(["# Fresh", "Hello."]);
    expect(created.updatedAt).toBe(row?.updatedAt as string);
    expect(stub.requests.at(-1)).toMatchObject({ method: "PUT" });
  });

  it("needs a title", async () => {
    const out = io();
    expect(await run(["doc", "create"], out.io)).toBe(2);
    expect(JSON.parse(out.stderr()).message).toContain("--title");
  });

  it("refuses a blank body before it calls anything", async () => {
    const out = io();
    expect(
      await run(["doc", "create", "--title", "Fresh", "--text", "   "], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).message).toContain("blank");
    expect(stub.requests).toHaveLength(0);
  });

  it("names the document it created when the body write fails", async () => {
    const out = io();
    stub.control.failMarkdownWrites = true;
    expect(
      await run(["doc", "create", "--title", "Fresh", "--text", "Hi."], out.io),
    ).toBe(1);
    const error = JSON.parse(out.stderr());
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(stub.rows.get(error.createdId)).toMatchObject({
      title: "Fresh",
      blocks: [],
    });
  });
});

describe("doc append", () => {
  it("appends a file's markdown", async () => {
    const file = join(
      await mkdtemp(join(tmpdir(), "lexidraw-doc-")),
      "notes.md",
    );
    await Bun.write(file, "## Notes\n\nFrom a file.\n");
    const out = io();
    expect(
      await run(["doc", "append", "doc-plan", "--file", file], out.io),
    ).toBe(0);
    expect(stub.rows.get("doc-plan")?.blocks).toEqual([
      "# Plan",
      "The body.",
      "## Notes",
      "From a file.\n",
    ]);
  });

  it("reads stdin for --file -", async () => {
    const out = io("From stdin.");
    expect(
      await run(["doc", "append", "doc-plan", "--file", "-"], out.io),
    ).toBe(0);
    expect(stub.rows.get("doc-plan")?.blocks.at(-1)).toBe("From stdin.");
  });

  it("passes --if-unmodified-since through", async () => {
    const out = io();
    expect(
      await run(
        [
          "doc",
          "append",
          "doc-plan",
          "--text",
          "More.",
          "--if-unmodified-since",
          revision("doc-plan"),
        ],
        out.io,
      ),
    ).toBe(0);
    expect(JSON.parse(out.stdout()).appendedBlocks).toBe(1);
  });

  it("surfaces a 409 with the current revision", async () => {
    const out = io();
    expect(
      await run(
        [
          "doc",
          "append",
          "doc-plan",
          "--text",
          "More.",
          "--if-unmodified-since",
          "2020-01-01T00:00:00.000Z",
        ],
        out.io,
      ),
    ).toBe(1);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "CONFLICT",
      status: 409,
      data: { currentUpdatedAt: revision("doc-plan") },
    });
  });

  it("needs markdown to write", async () => {
    const out = io();
    expect(await run(["doc", "append", "doc-plan"], out.io)).toBe(2);
    expect(JSON.parse(out.stderr()).message).toContain("--file");
  });

  it("refuses blank markdown from stdin before it calls anything", async () => {
    const out = io("  \n");
    expect(
      await run(["doc", "append", "doc-plan", "--file", "-"], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).message).toContain("blank");
    expect(stub.requests).toHaveLength(0);
  });
});

describe("doc insert", () => {
  it("inserts after a heading", async () => {
    const out = io();
    expect(
      await run(
        [
          "doc",
          "insert",
          "doc-plan",
          "--text",
          "Inserted.",
          "--after-heading",
          "Plan",
          "--if-unmodified-since",
          "latest",
        ],
        out.io,
      ),
    ).toBe(0);
    expect(stub.rows.get("doc-plan")?.blocks).toEqual([
      "# Plan",
      "Inserted.",
      "The body.",
    ]);
  });

  it("inserts at a block index", async () => {
    const out = io();
    expect(
      await run(
        [
          "doc",
          "insert",
          "doc-plan",
          "--text",
          "First.",
          "--at-block",
          "0",
          "--if-unmodified-since",
          revision("doc-plan"),
        ],
        out.io,
      ),
    ).toBe(0);
    expect(stub.rows.get("doc-plan")?.blocks[0]).toBe("First.");
  });

  it("surfaces the candidates of an ambiguous heading, and --nth picks one", async () => {
    stub.rows.set("doc-twin", {
      id: "doc-twin",
      title: "Twin headings",
      entityType: "document",
      parentId: null,
      updatedAt: "2026-03-01T00:00:00.000Z",
      blocks: ["# Same", "One.", "# Same", "Two."],
    });
    const ambiguous = io();
    expect(
      await run(
        [
          "doc",
          "insert",
          "doc-twin",
          "--text",
          "x",
          "--after-heading",
          "Same",
          "--if-unmodified-since",
          "latest",
        ],
        ambiguous.io,
      ),
    ).toBe(1);
    expect(JSON.parse(ambiguous.stderr()).data.candidates).toHaveLength(2);

    const picked = io();
    expect(
      await run(
        [
          "doc",
          "insert",
          "doc-twin",
          "--text",
          "x",
          "--after-heading",
          "Same",
          "--nth",
          "2",
          "--if-unmodified-since",
          "latest",
        ],
        picked.io,
      ),
    ).toBe(0);
    expect(stub.rows.get("doc-twin")?.blocks[3]).toBe("x");
  });

  it("is a usage error without a precondition", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "insert", "doc-plan", "--text", "x", "--at-block", "0"],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "USAGE",
      message: expect.stringContaining("--if-unmodified-since"),
    });
    expect(stub.rows.get("doc-plan")?.blocks).toHaveLength(2);
  });

  it("needs exactly one place to write", async () => {
    const out = io();
    expect(
      await run(
        [
          "doc",
          "insert",
          "doc-plan",
          "--text",
          "x",
          "--at-block",
          "0",
          "--after-heading",
          "Plan",
          "--if-unmodified-since",
          "latest",
        ],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).code).toBe("USAGE");
  });
});

describe("doc put", () => {
  it("refuses to replace without --replace", async () => {
    const out = io();
    expect(
      await run(
        [
          "doc",
          "put",
          "doc-plan",
          "--text",
          "# Replaced",
          "--if-unmodified-since",
          "latest",
        ],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "USAGE",
      message: expect.stringContaining("--replace"),
    });
    expect(stub.rows.get("doc-plan")?.blocks).toHaveLength(2);
  });

  it("refuses to replace without a precondition", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "put", "doc-plan", "--replace", "--text", "# Replaced"],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "USAGE",
      message: expect.stringContaining("--if-unmodified-since"),
    });
  });

  it("replaces against the revision it read for --if-unmodified-since latest", async () => {
    const out = io();
    expect(
      await run(
        [
          "doc",
          "put",
          "doc-plan",
          "--replace",
          "--text",
          "# Replaced",
          "--if-unmodified-since",
          "latest",
        ],
        out.io,
      ),
    ).toBe(0);
    expect(stub.rows.get("doc-plan")?.blocks).toEqual(["# Replaced"]);
  });
});

describe("doc delete", () => {
  it("deletes the entity it resolved", async () => {
    const out = io();
    expect(await run(["doc", "delete", "--path", "Notes/Plan"], out.io)).toBe(
      0,
    );
    expect(JSON.parse(out.stdout())).toEqual({ id: "doc-plan" });
    expect(stub.rows.has("doc-plan")).toBe(false);
  });

  it("refuses an id that names a directory", async () => {
    const out = io();
    expect(await run(["doc", "delete", "dir-notes"], out.io)).toBe(1);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "NOT_FOUND",
      entityType: "directory",
    });
    expect(stub.rows.has("dir-notes")).toBe(true);
    expect(stub.requests.every((call) => call.method !== "DELETE")).toBe(true);
  });

  it("reports an id that names nothing", async () => {
    const out = io();
    expect(await run(["doc", "delete", "nope"], out.io)).toBe(1);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
