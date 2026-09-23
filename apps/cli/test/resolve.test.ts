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
      id: "doc-deep",
      title: "Deep",
      entityType: "document",
      parentId: "dir-sub",
      blocks: ["# Deep"],
    },
    // Two documents sharing a title, the second the more recent.
    {
      id: "doc-old",
      title: "Twin",
      entityType: "document",
      parentId: "dir-notes",
    },
    {
      id: "doc-new",
      title: "Twin",
      entityType: "document",
      parentId: "dir-notes",
    },
    { id: "doc-case", title: "MiXeD", entityType: "document" },
    // Two directories sharing a title, so a segment on the way can be
    // ambiguous as well as the last one.
    { id: "dir-twin-a", title: "Twins", entityType: "directory" },
    { id: "dir-twin-b", title: "Twins", entityType: "directory" },
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

describe("--path", () => {
  it("walks directory titles down to the document", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "get", "--path", "Notes/Sub/Deep", "--format", "raw"],
        out.io,
      ),
    ).toBe(0);
    expect(out.stdout()).toBe("# Deep\n");
    expect(out.stderr()).toBe("");
  });

  it("falls back to a case-insensitive match", async () => {
    const out = io();
    expect(await run(["doc", "delete", "--path", "mixed"], out.io)).toBe(0);
    expect(JSON.parse(out.stdout())).toEqual({ id: "doc-case" });
  });

  it("reads the most recent of several matches and warns", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "get", "--path", "Notes/Twin", "--format", "raw"],
        out.io,
      ),
    ).toBe(0);
    expect(out.stderr()).toBe(
      'warning: "Twin" matches 2 entities (doc-new, doc-old); reading doc-new, the most recently updated\n',
    );
  });

  it("refuses an ambiguous write, naming the candidates", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "append", "--path", "Notes/Twin", "--text", "x"],
        out.io,
      ),
    ).toBe(1);
    const error = JSON.parse(out.stderr());
    expect(error.code).toBe("AMBIGUOUS_PATH");
    expect(error.parentId).toBe("dir-notes");
    expect(error.candidates.map((row: { id: string }) => row.id)).toEqual([
      "doc-new",
      "doc-old",
    ]);
    expect(error.message).toContain("pass --nth N, or the id");
    expect(error.candidates[0]).toHaveProperty("updatedAt");
    expect(stub.rows.get("doc-new")?.blocks).toEqual([]);
  });

  it("picks a match with --nth, counting from the most recent", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "append", "--path", "Notes/Twin", "--nth", "2", "--text", "x"],
        out.io,
      ),
    ).toBe(0);
    expect(stub.rows.get("doc-old")?.blocks).toEqual(["x"]);
    expect(stub.rows.get("doc-new")?.blocks).toEqual([]);
  });

  it("fails an --nth past the matches", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "append", "--path", "Notes/Twin", "--nth", "3", "--text", "x"],
        out.io,
      ),
    ).toBe(1);
    expect(JSON.parse(out.stderr()).code).toBe("NOT_FOUND");
  });

  it("names the parent and the segment that found nothing", async () => {
    const out = io();
    expect(await run(["doc", "get", "--path", "Notes/Missing"], out.io)).toBe(
      1,
    );
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "NOT_FOUND",
      segment: "Missing",
      parentId: "dir-notes",
    });
  });

  it("stops at the directory segment that does not exist", async () => {
    const out = io();
    expect(await run(["doc", "get", "--path", "Nope/Deep"], out.io)).toBe(1);
    expect(JSON.parse(out.stderr())).toMatchObject({
      segment: "Nope",
      parentId: null,
    });
  });

  it("rejects an id and a --path together", async () => {
    const out = io();
    expect(
      await run(["doc", "get", "doc-deep", "--path", "Notes/Sub/Deep"], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).code).toBe("USAGE");
  });

  it("rejects an empty segment", async () => {
    const out = io();
    expect(await run(["doc", "get", "--path", "Notes//Deep"], out.io)).toBe(2);
    expect(JSON.parse(out.stderr()).message).toContain("empty segment");
  });
});

describe("an ambiguous directory on the way", () => {
  it("sends a --path write to the document's own id", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "append", "--path", "Twins/Any", "--text", "x"],
        out.io,
      ),
    ).toBe(1);
    const error = JSON.parse(out.stderr());
    expect(error.code).toBe("AMBIGUOUS_PATH");
    expect(error.message).toContain("address the document by id");
    expect(
      error.candidates.map((row: { id: string }) => row.id).sort(),
    ).toEqual(["dir-twin-a", "dir-twin-b"]);
  });

  it("sends a --dir-path write to the directory's own id", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "create", "--title", "Fresh", "--dir-path", "Twins"],
        out.io,
      ),
    ).toBe(1);
    expect(JSON.parse(out.stderr()).message).toContain(
      "address the directory by id (--dir <id>)",
    );
  });
});

describe("--dir and --dir-path", () => {
  it("walks directory titles for --dir-path", async () => {
    const out = io();
    expect(await run(["doc", "list", "--dir-path", "Notes/Sub"], out.io)).toBe(
      0,
    );
    expect(
      JSON.parse(out.stdout()).map((row: { id: string }) => row.id),
    ).toEqual(["doc-deep"]);
  });

  it("takes --dir as an id, whatever the id looks like", async () => {
    const out = io();
    expect(await run(["doc", "list", "--dir", "dir-sub"], out.io)).toBe(0);
    expect(
      JSON.parse(out.stdout()).map((row: { id: string }) => row.id),
    ).toEqual(["doc-deep"]);
    expect(stub.requests.at(-1)?.path).toContain("parentId=dir-sub");
  });

  it("refuses both at once", async () => {
    const out = io();
    expect(
      await run(
        ["doc", "list", "--dir", "dir-sub", "--dir-path", "Notes/Sub"],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).code).toBe("USAGE");
  });
});
