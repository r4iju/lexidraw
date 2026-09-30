import { expect, test } from "bun:test";
import { savedBlock, changeBlock, blocksIn } from "./content";
const source = {
  html: "<p>Dashboard</p>",
  description: "Revenue",
  data: { total: 1 },
};
test("update retains identity and surroundings, rejects stale document writes", async () => {
  const block = savedBlock(source, "one");
  const state = {
    root: {
      type: "root",
      children: [
        { type: "paragraph", text: "before" },
        { type: "html-block", version: 1, block },
        { type: "paragraph", text: "after" },
      ],
    },
  };
  const revision = {
    id: "doc",
    title: "T",
    elements: JSON.stringify(state),
    updatedAt: new Date("2026-01-01"),
    appState: null,
    tags: [],
  };
  const store = {
    read: async () => revision,
    write: async (_id: string, change: { elements: string }) => {
      revision.elements = change.elements;
      return { id: "doc", updatedAt: revision.updatedAt };
    },
  };
  const result = await changeBlock(
    store,
    revision,
    {
      kind: "update",
      blockId: "one",
      source: { ...source, data: { total: 2 } },
    },
    revision.updatedAt.toISOString(),
  );
  expect(result.block?.id).toBe("one");
  expect(result.block?.revision).not.toBe(block.revision);
  expect(JSON.parse(revision.elements).root.children[0]).toEqual(
    state.root.children[0],
  );
  expect(blocksIn(revision.elements)[0]?.data).toEqual({ total: 2 });
  await expect(
    changeBlock(
      store,
      revision,
      { kind: "delete", blockId: "one" },
      "2025-01-01T00:00:00.000Z",
    ),
  ).rejects.toThrow("modified");
  await changeBlock(
    store,
    revision,
    { kind: "delete", blockId: "one" },
    revision.updatedAt.toISOString(),
  );
  expect(blocksIn(revision.elements)).toEqual([]);
});
test("revision includes saved defaults and all forward fields, independent of key order", () => {
  expect(savedBlock({ ...source, defaults: { x: 3 } }).revision).not.toBe(
    savedBlock({ ...source, defaults: { x: 4 } }).revision,
  );
  expect(savedBlock(source).revision).toBe(
    savedBlock({
      data: { total: 1 },
      description: "Revenue",
      html: "<p>Dashboard</p>",
    }).revision,
  );
});
