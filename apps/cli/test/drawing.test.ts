import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/cli";
import { type EntityStub, startEntityStub, stubEnv } from "./entity-stub";
import { fakeIo } from "./helpers";

let stub: EntityStub;

beforeEach(() => {
  stub = startEntityStub([
    { id: "dir-notes", title: "Notes", entityType: "directory" },
    {
      id: "drw-flow",
      title: "Flow",
      entityType: "drawing",
      parentId: "dir-notes",
    },
    // A document of the same title, which a drawing's path never matches.
    {
      id: "doc-flow",
      title: "Flow",
      entityType: "document",
      parentId: "dir-notes",
    },
    // Two drawings sharing a title, the second the more recent.
    {
      id: "drw-old",
      title: "Twin",
      entityType: "drawing",
      parentId: "dir-notes",
    },
    {
      id: "drw-new",
      title: "Twin",
      entityType: "drawing",
      parentId: "dir-notes",
    },
  ]);
});

afterEach(() => {
  stub.stop();
});

function io() {
  return fakeIo({ env: stubEnv(stub) });
}

const writes = () =>
  stub.requests.filter(({ method }) => method === "PUT" || method === "POST");

async function elementsFile(): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), "lexidraw-drawing-")), "e");
  await Bun.write(file, "[]");
  return file;
}

describe("drawing create", () => {
  it("creates the drawing in the directory --dir-path names", async () => {
    const out = io();
    expect(
      await run(
        ["drawing", "create", "--title", "Map", "--dir-path", "Notes"],
        out.io,
      ),
    ).toBe(0);
    const { id } = JSON.parse(out.stdout());
    expect(stub.rows.get(id)).toMatchObject({
      title: "Map",
      parentId: "dir-notes",
    });
  });

  it("refuses --dir with --dir-path, without a write", async () => {
    const out = io();
    expect(
      await run(
        [
          "drawing",
          "create",
          "--title",
          "Map",
          "--dir",
          "dir-notes",
          "--dir-path",
          "Notes",
        ],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).message).toBe(
      "--dir takes an id and --dir-path a path; give one",
    );
    expect(writes()).toEqual([]);
  });

  it("refuses --parent as an unknown flag", async () => {
    const out = io();
    expect(
      await run(
        ["drawing", "create", "--title", "Map", "--parent", "dir-notes"],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr())).toMatchObject({
      code: "USAGE",
      message: "unknown flag --parent",
    });
    expect(writes()).toEqual([]);
  });
});

describe("drawing --path", () => {
  it("get reads the drawing, never a document of that title", async () => {
    const out = io();
    expect(await run(["drawing", "get", "--path", "Notes/Flow"], out.io)).toBe(
      0,
    );
    expect(JSON.parse(out.stdout()).id).toBe("drw-flow");
    expect(out.stderr()).toBe("");
  });

  it("render draws the drawing the path names", async () => {
    const out = io();
    expect(
      await run(["drawing", "render", "--path", "Notes/Flow"], out.io),
    ).toBe(0);
    expect(out.stdout()).toBe("<svg>drw-flow</svg>");
  });

  it("put writes the drawing the path names", async () => {
    const out = io();
    const before = stub.rows.get("drw-flow")?.updatedAt;
    expect(
      await run(
        [
          "drawing",
          "put",
          "--path",
          "Notes/Flow",
          "--file",
          await elementsFile(),
          "--if-unmodified-since",
          "latest",
        ],
        out.io,
      ),
    ).toBe(0);
    expect(writes().map(({ path }) => path)).toEqual([
      "/api/v1/drawings/drw-flow",
    ]);
    expect(stub.rows.get("drw-flow")?.updatedAt).not.toBe(before);
  });

  it("put refuses an ambiguous path, naming the candidates", async () => {
    const out = io();
    expect(
      await run(
        [
          "drawing",
          "put",
          "--path",
          "Notes/Twin",
          "--file",
          await elementsFile(),
          "--if-unmodified-since",
          "latest",
        ],
        out.io,
      ),
    ).toBe(1);
    const error = JSON.parse(out.stderr());
    expect(error.code).toBe("AMBIGUOUS_PATH");
    expect(error.candidates.map((row: { id: string }) => row.id)).toEqual([
      "drw-new",
      "drw-old",
    ]);
    expect(writes()).toEqual([]);
  });

  it("get picks one of several with --nth", async () => {
    const out = io();
    expect(
      await run(
        ["drawing", "get", "--path", "Notes/Twin", "--nth", "2"],
        out.io,
      ),
    ).toBe(0);
    expect(JSON.parse(out.stdout()).id).toBe("drw-old");
  });

  it("refuses an id and a --path together", async () => {
    const out = io();
    expect(
      await run(["drawing", "get", "drw-flow", "--path", "Notes/Flow"], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).message).toBe(
      "give an id or --path, not both",
    );
  });

  it("refuses --nth without --path", async () => {
    const out = io();
    expect(
      await run(["drawing", "render", "drw-flow", "--nth", "1"], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).message).toBe(
      "--nth chooses between paths; drop it or drop the id",
    );
  });
});

describe("drawing arguments", () => {
  it("names its verbs when given another", async () => {
    const out = io();
    expect(await run(["drawing", "erase", "drw-flow"], out.io)).toBe(2);
    expect(JSON.parse(out.stderr()).known).toEqual([
      "get",
      "put",
      "create",
      "render",
      "delete",
    ]);
  });

  it("refuses a flag that belongs to another verb", async () => {
    const out = io();
    expect(
      await run(["drawing", "get", "drw-flow", "--file", "e.json"], out.io),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).message).toBe("unknown flag --file");
  });

  it("put names what is missing before reading the elements", async () => {
    const out = fakeIo({ env: stubEnv(stub), stdin: "not json" });
    expect(
      await run(
        ["drawing", "put", "--file", "-", "--if-unmodified-since", "latest"],
        out.io,
      ),
    ).toBe(2);
    expect(JSON.parse(out.stderr()).message).toStartWith("name the drawing");
  });
});

describe("a drawing path through an ambiguous directory", () => {
  beforeEach(() => {
    stub.rows.set("dir-notes-2", {
      id: "dir-notes-2",
      title: "Notes",
      entityType: "directory",
      parentId: null,
      updatedAt: "2026-06-01T00:00:00.000Z",
      blocks: [],
    });
  });

  it("refuses a write, with the drawing's own way out", async () => {
    const out = io();
    const file = await elementsFile();
    const argv = ["drawing", "put", "--path", "Notes/Flow", "--file", file];
    expect(
      await run([...argv, "--if-unmodified-since", "latest"], out.io),
    ).toBe(1);
    const error = JSON.parse(out.stderr());
    expect(error.code).toBe("AMBIGUOUS_PATH");
    expect(error.message).toContain("address the drawing by id");
    expect(writes()).toEqual([]);
  });

  it("does not let --nth settle the directory for a write", async () => {
    const out = io();
    const file = await elementsFile();
    expect(
      await run(
        [
          "drawing",
          "put",
          "--path",
          "Notes/Flow",
          "--nth",
          "1",
          "--file",
          file,
          "--if-unmodified-since",
          "latest",
        ],
        out.io,
      ),
    ).toBe(1);
    expect(JSON.parse(out.stderr()).code).toBe("AMBIGUOUS_PATH");
    expect(writes()).toEqual([]);
  });
});

describe("drawing delete", () => {
  const deletes = () =>
    stub.requests.filter(({ method }) => method === "DELETE");

  it("deletes the drawing its path names, never the document of that title", async () => {
    const out = io();
    expect(
      await run(["drawing", "delete", "--path", "Notes/Flow"], out.io),
    ).toBe(0);
    expect(JSON.parse(out.stdout())).toEqual({ id: "drw-flow" });
    expect(stub.rows.has("drw-flow")).toBe(false);
    expect(stub.rows.has("doc-flow")).toBe(true);
  });

  it("deletes a drawing by id", async () => {
    const out = io();
    expect(await run(["drawing", "delete", "drw-old"], out.io)).toBe(0);
    expect(stub.rows.has("drw-old")).toBe(false);
  });

  it("refuses an id that names a directory or a document", async () => {
    for (const [id, entityType] of [
      ["dir-notes", "directory"],
      ["doc-flow", "document"],
    ] as const) {
      const out = io();
      expect(await run(["drawing", "delete", id], out.io)).toBe(1);
      expect(JSON.parse(out.stderr())).toMatchObject({
        code: "NOT_FOUND",
        message: `"${id}" is a ${entityType}, not a drawing`,
        entityType,
      });
      expect(stub.rows.has(id)).toBe(true);
    }
    expect(deletes()).toEqual([]);
  });

  it("will not pick among drawings sharing a path", async () => {
    const out = io();
    expect(
      await run(["drawing", "delete", "--path", "Notes/Twin"], out.io),
    ).toBe(1);
    expect(JSON.parse(out.stderr()).code).toBe("AMBIGUOUS_PATH");
    expect(deletes()).toEqual([]);
  });
});
