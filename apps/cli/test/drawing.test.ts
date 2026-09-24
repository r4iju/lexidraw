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
