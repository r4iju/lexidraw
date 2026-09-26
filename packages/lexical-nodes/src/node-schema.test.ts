import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { ElementNode, type SerializedElementNode } from "lexical";
import { exportNodeSchema, NODE_SCHEMA_URL } from "./node-schema.js";
import { CORE_NODES } from "./nodes.js";

const schema = exportNodeSchema(CORE_NODES);

function node(type: string) {
  return schema.nodes.find((candidate) => candidate.type === type);
}

test("describes a built-in node's version, children and field types", () => {
  expect(node("heading")).toEqual({
    type: "heading",
    version: 1,
    children: true,
    fields: {
      direction: { kind: "enum", values: [null, "ltr", "rtl"], default: null },
      format: {
        kind: "enum",
        values: ["", "left", "start", "center", "right", "end", "justify"],
        default: "",
      },
      indent: { kind: "number", integer: true, min: 0, default: 0 },
      tag: {
        kind: "enum",
        values: ["h1", "h2", "h3", "h4", "h5", "h6"],
        default: "h1",
      },
      textFormat: { kind: "number", default: 0 },
      textStyle: { kind: "string", default: "" },
    },
    state: {},
  });
  expect(node("linebreak")).toEqual({
    type: "linebreak",
    version: 1,
    children: false,
    fields: {},
    state: {},
  });
});

test("describes how Lexical reads each field, down to aliases and bounds", () => {
  expect(node("listitem")?.fields.indent).toEqual({
    kind: "number",
    clamp: true,
    integer: true,
    max: 128,
    min: 0,
    default: 0,
  });
  expect(node("link")?.fields.rel).toEqual({
    kind: "nullable",
    defaultAsNull: true,
    inner: { kind: "string", default: "" },
    default: null,
  });
  expect(node("list")?.fields.listType).toEqual({
    kind: "aliased",
    aliases: { ol: "number", ul: "bullet" },
    inner: {
      kind: "enum",
      values: ["number", "bullet", "check"],
      default: "number",
    },
    default: "number",
  });
  expect(node("tablecell")?.fields.width).toEqual({
    kind: "optional",
    omitDefault: true,
    inner: { kind: "number", default: 0 },
  });
  // Lexical's `undefined` member is absence, which JSON can't list.
  expect(node("tablecell")?.fields.verticalAlign).toEqual({
    kind: "enum",
    values: ["middle", "bottom"],
  });
});

test("lists node state apart from fields", () => {
  expect(node("quote")?.state).toEqual({
    shadowRoot: { flat: true, value: { kind: "boolean", default: false } },
  });
  expect(node("quote")?.fields).not.toHaveProperty("shadowRoot");
});

test("covers every registered node, listing custom ones as undeclared by type", () => {
  const registered = [
    ...createHeadlessEditor({ nodes: CORE_NODES })._nodes.keys(),
  ];
  const declared = schema.nodes.map((described) => described.type);

  expect([...declared, ...schema.undeclared].sort()).toEqual(registered.sort());
  expect(declared).toEqual(
    expect.arrayContaining(["root", "paragraph", "text", "table", "link"]),
  );
  expect(schema.undeclared).toEqual(
    expect.arrayContaining(["callout", "code", "image", "autocomplete"]),
  );
});

test("refuses a declared node that writes a property its schema leaves out", () => {
  class LooseNode extends ElementNode {
    $config() {
      return this.config("loose", { extends: ElementNode });
    }
    exportJSON(): SerializedElementNode & { extra: number } {
      return { ...super.exportJSON(), extra: 1 };
    }
  }

  expect(() => exportNodeSchema([LooseNode])).toThrow(/loose.*extra/);
});

test("the committed schema is a fresh export", async () => {
  // `bun run node-schema` in packages/lexical-nodes rewrites it.
  const committed = await Bun.file(NODE_SCHEMA_URL).json();
  expect(committed).toEqual(schema);
});
