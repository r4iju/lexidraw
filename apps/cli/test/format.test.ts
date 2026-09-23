import { describe, expect, it } from "bun:test";

import { entityTable, ndjson, table } from "../src/format";

describe("table", () => {
  it("pads every column to its widest cell and leaves the last one alone", () => {
    expect(
      table(
        ["id", "title"],
        [
          ["1", "short"],
          ["longer", "a"],
        ],
      ),
    ).toBe("id      title\n1       short\nlonger  a\n");
  });

  it("prints the header alone when there is nothing to list", () => {
    expect(table(["id"], [])).toBe("id\n");
  });
});

describe("entityTable", () => {
  it("renders the fields a listing shares", () => {
    const row = {
      id: "abc",
      title: "Plan",
      entityType: "document",
      updatedAt: "2026-01-01T00:00:00.000Z",
      parentId: "dir",
    };
    expect(entityTable([row])).toBe(
      "id   title  type      updatedAt\nabc  Plan   document  2026-01-01T00:00:00.000Z\n",
    );
    expect(entityTable([row], { parent: true })).toEndWith("  dir\n");
  });

  it("leaves the parent column empty at the root", () => {
    expect(
      entityTable(
        [{ id: "a", title: "b", entityType: "directory", updatedAt: "c" }],
        { parent: true },
      ),
    ).toBe(
      "id  title  type       updatedAt  parentId\na   b      directory  c\n",
    );
  });
});

describe("ndjson", () => {
  it("writes one object per line", () => {
    expect(ndjson([{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n{"b":2}\n');
  });
});
