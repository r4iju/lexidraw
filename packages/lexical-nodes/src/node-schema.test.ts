import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  ArtificialNode__DO_NOT_USE,
  ElementNode,
  type SerializedElementNode,
} from "lexical";
import {
  exportNodeSchema,
  NODE_SCHEMA_URL,
  nodeSchemaFile,
} from "./node-schema.js";
import { CORE_NODES } from "./nodes.js";

const schema = exportNodeSchema(CORE_NODES);

function node(type: string) {
  return schema.nodes.find((candidate) => candidate.type === type);
}

test("names each node by its Lexical class", () => {
  expect(node("listitem")?.className).toBe("ListItemNode");
  expect(node("horizontalrule")?.className).toBe("HorizontalRuleNode");
});

test("describes how Lexical reads each field, down to aliases and bounds", () => {
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

test("covers every registered node but Lexical's never-stored artificial one, listing custom ones as undeclared by type", () => {
  const registered = [
    ...createHeadlessEditor({ nodes: CORE_NODES })._nodes.keys(),
  ].filter((type) => type !== ArtificialNode__DO_NOT_USE.getType());
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

test("refuses a class name that Lexical's production build minified", () => {
  const Ht = class extends ElementNode {
    $config() {
      return this.config("minified", { extends: ElementNode });
    }
  };

  expect(() => exportNodeSchema([Ht])).toThrow(/minified.*Ht/);
});

test("the committed schema is a fresh export, byte for byte", async () => {
  const committed = await Bun.file(NODE_SCHEMA_URL).text();
  expect(committed).toBe(nodeSchemaFile(schema));
});
