import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  ArtificialNode__DO_NOT_USE,
  createState,
  DecoratorNode,
  ElementNode,
  numberValue,
  objectValue,
  type SerializedElementNode,
  type SerializedLexicalNode,
} from "lexical";
import {
  exportNodeSchema,
  NODE_SCHEMA_URL,
  type NodeSchema,
  nodeSchemaFile,
} from "./node-schema.js";
import { SCHEMA_NODES } from "./nodes.js";
import { namedTransform } from "./schema-values.js";
import {
  EVERY_NODE_URL,
  STORED_BYTES_URL,
  type StoredCase,
} from "./stored-fixtures.js";

const schema = exportNodeSchema(SCHEMA_NODES);

function node(type: string) {
  return described(schema, type);
}

type WrittenNode = { type: string } & Record<string, unknown>;

/**
 * `node` and every node under it: its children, and the root of an editor
 * nested in one of its fields, as a caption is.
 */
function nodesIn(node: WrittenNode): WrittenNode[] {
  const nested = Object.values(node).flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const editor = "editorState" in value ? value.editorState : value;
    return typeof editor === "object" && editor !== null && "root" in editor
      ? [editor.root as WrittenNode]
      : [];
  });
  const children = Array.isArray(node.children)
    ? (node.children as WrittenNode[])
    : [];
  return [node, ...[...children, ...nested].flatMap(nodesIn)];
}

function described(exported: NodeSchema, type: string) {
  return exported.nodes.find((candidate) => candidate.type === type);
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

test("marks a field a node leaves unwritten at its default as omitting it", () => {
  expect(node("table")?.fields.rowStriping).toEqual({
    kind: "optional",
    omitDefault: true,
    inner: { kind: "boolean", default: false },
  });
  expect(node("table")?.fields.frozenRowCount).toEqual({
    kind: "optional",
    omitDefault: true,
    inner: { kind: "number", default: 0 },
  });
});

test("lists node state apart from fields", () => {
  expect(node("quote")?.state).toEqual({
    shadowRoot: { flat: true, value: { kind: "boolean", default: false } },
  });
  expect(node("quote")?.fields).not.toHaveProperty("shadowRoot");
});

test("covers every registered node but Lexical's never-stored artificial one", () => {
  const registered = [
    ...createHeadlessEditor({ nodes: SCHEMA_NODES })._nodes.keys(),
  ].filter((type) => type !== ArtificialNode__DO_NOT_USE.getType());
  const declared = schema.nodes.map((described) => described.type);

  expect(declared.sort()).toEqual(registered.sort());
  expect(declared).toEqual(
    expect.arrayContaining(["root", "paragraph", "text", "table", "link"]),
  );
});

test("refuses a node that doesn't declare its JSON, by type", () => {
  class LegacyNode extends DecoratorNode<null> {
    static getType() {
      return "legacy";
    }
    static clone(node: LegacyNode) {
      return new LegacyNode(node.__key);
    }
    decorate() {
      return null;
    }
  }

  expect(() => exportNodeSchema([LegacyNode])).toThrow(/^legacy: /);
});

test("describes the light custom nodes' figures and threads", () => {
  expect(node("emoji")?.fields.className).toEqual({ kind: "raw" });
  expect(node("layout-container")?.state.figure?.value).toMatchObject({
    kind: "raw",
    shape: {
      kind: "object",
      fields: { width: { kind: "optional", inner: { name: "figureWidth" } } },
    },
  });
  expect(node("thread")?.order).toContain("children");
});

test("an object in a value kept as stored keeps the keys it doesn't declare", () => {
  expect(node("thread")?.fields.thread).toMatchObject({
    kind: "raw",
    shape: {
      kind: "object",
      open: true,
      fields: { comments: { kind: "array", item: { open: true } } },
    },
  });
  expect(node("image")?.fields.caption).not.toHaveProperty("open");
});

test("describes the heavy decorator nodes' sizes, unions and dropped theme", () => {
  expect(node("image")?.fields.width).toEqual({
    kind: "transform",
    name: "storedSize",
    inner: { kind: "raw" },
    default: 0,
  });
  expect(node("image")?.state.natural?.value).toMatchObject({
    kind: "raw",
    shape: { kind: "transform", name: "naturalSize" },
  });
  expect(node("chart")?.fields.width).toEqual({
    kind: "transform",
    name: "zeroAsInherit",
    inner: { kind: "raw", default: "inherit" },
    default: "inherit",
  });
  expect(node("article")?.fields.data).toMatchObject({
    kind: "raw",
    shape: { kind: "union" },
  });
  expect(node("code")?.fields.theme).toEqual({ kind: "enum", values: [] });
  expect(node("code")?.fields.language).toEqual({
    kind: "optional",
    inner: {
      kind: "transform",
      name: "emptyAbsent",
      inner: { kind: "string", default: "" },
    },
  });
  expect(node("image")?.fields.caption).toMatchObject({
    kind: "object",
    fields: { editorState: { kind: "transform", name: "nestedEditorState" } },
  });
});

test("describes a value kept as stored: its default, null read as absent, its shape", () => {
  expect(node("excalidraw")?.fields.data).toEqual({
    kind: "raw",
    default: "[]",
    nullAsAbsent: true,
  });
  expect(node("slide-deck")?.fields.data).toMatchObject({
    kind: "raw",
    nullAsAbsent: true,
    shape: { kind: "object", fields: { slides: { kind: "array" } } },
  });
});

test("describes a value checked only where the node holds NodeState", () => {
  expect(node("tweet")?.fields.format).toEqual({
    kind: "raw",
    withState: {
      kind: "enum",
      values: ["", "left", "start", "center", "right", "end", "justify"],
      default: "",
    },
  });
});

test("describes a property written as the node holds it but never read", () => {
  expect(node("collapsible-title")?.fields.direction).toEqual({
    kind: "unread",
    inner: { kind: "enum", values: [null, "ltr", "rtl"], default: null },
  });
  expect(node("layout-item")?.fields.textStyle).toEqual({
    kind: "unread",
    gated: true,
    inner: { kind: "string", default: "" },
  });
});

test("lists each node's keys in the order it writes them", () => {
  expect(node("paragraph")?.order).toEqual([
    "children",
    "direction",
    "format",
    "indent",
    "textFormat",
    "textStyle",
    "type",
    "version",
    "$",
  ]);
  expect(node("emoji")?.order).toEqual([
    "detail",
    "format",
    "mode",
    "style",
    "text",
    "type",
    "version",
    "className",
  ]);
});

test("every node the web saved has its keys in that order", async () => {
  const cases: StoredCase[] = await Bun.file(STORED_BYTES_URL).json();
  const saved = cases.flatMap(({ node, output, threw }) =>
    threw ? [] : (output ?? [node]),
  );
  const editor = createHeadlessEditor({ nodes: SCHEMA_NODES });
  editor.setEditorState(
    editor.parseEditorState(await Bun.file(EVERY_NODE_URL).text()),
  );
  const outOfOrder = [...saved, editor.getEditorState().toJSON().root].flatMap(
    (json) =>
      nodesIn(json).flatMap((written) => {
        const order = node(written.type)?.order ?? [];
        const keys = Object.keys(written);
        const placed = order.filter((key) => keys.includes(key));
        return placed.length === keys.length &&
          placed.every((key, index) => key === keys[index])
          ? []
          : [`${written.type}: ${keys.join(", ")}`];
      }),
  );

  expect(saved.length).toBeGreaterThan(4000);
  expect(outOfOrder).toEqual([]);
});

test("says which nodes keep the NodeState they were read with, by placing it", () => {
  expect(node("paragraph")?.order).toContain("$");
  expect(node("image")?.order).toContain("$");
  expect(node("emoji")?.order).not.toContain("$");
  expect(node("slide-deck")?.order).not.toContain("$");
});

test("lists an object's fields in the order Lexical writes them", () => {
  const pointState = createState("point", {
    parse: objectValue({ y: numberValue(), x: numberValue() }),
  });
  class PointNode extends DecoratorNode<null> {
    $config() {
      return this.config("point", {
        extends: DecoratorNode,
        stateConfigs: [pointState],
      });
    }
    decorate() {
      return null;
    }
  }
  const point = described(exportNodeSchema([PointNode]), "point")?.state.point;

  expect(
    point?.value.kind === "object" && Object.keys(point.value.fields),
  ).toEqual(["y", "x"]);
});

test("names the transform a value is read through, down in nested state", () => {
  const even = namedTransform("even", numberValue(), (value) =>
    value % 2 === 0 ? value : undefined,
  );
  const evenState = createState("even", { parse: even });
  class EvenNode extends DecoratorNode<null> {
    $config() {
      return this.config("even", {
        extends: DecoratorNode,
        stateConfigs: [evenState],
      });
    }
    decorate() {
      return null;
    }
  }

  expect(described(exportNodeSchema([EvenNode]), "even")?.state).toEqual({
    even: {
      flat: false,
      value: {
        kind: "transform",
        name: "even",
        inner: { kind: "number", default: 0 },
        default: 0,
      },
    },
  });
});

test("says which node types an editor nested in a field reads, as the node makes that editor", () => {
  const nestedIn = (type: string, path: string[]) =>
    path.reduce<unknown>(
      (at, key) => (at as Record<string, unknown>)[key],
      node(type)?.fields,
    ) as { nestedEditor?: string[] };
  const imageCaption = nestedIn("image", ["caption", "fields", "editorState"]);
  const stickyCaption = nestedIn("sticky", [
    "caption",
    "fields",
    "editorState",
  ]);

  const everyType = [
    ...createHeadlessEditor({ nodes: SCHEMA_NODES })._nodes.keys(),
  ].sort();

  expect(imageCaption.nestedEditor).toEqual([
    "artificial",
    "emoji",
    "hashtag",
    "keyword",
    "linebreak",
    "link",
    "paragraph",
    "root",
    "tab",
    "text",
  ]);
  // Made without a config, as the document's editor reads it, an editor
  // takes that editor's nodes.
  expect(stickyCaption.nestedEditor).toEqual(everyType);
  expect(nestedIn("video", ["caption"]).nestedEditor).toEqual(everyType);
});

test("says a node has children when it writes a list of them, even one always empty", () => {
  class MarkerNode extends DecoratorNode<null> {
    $config() {
      return this.config("marker", { extends: DecoratorNode });
    }
    exportJSON(): SerializedLexicalNode & { children: [] } {
      return { ...super.exportJSON(), children: [] };
    }
    decorate() {
      return null;
    }
  }

  expect(described(exportNodeSchema([MarkerNode]), "marker")?.order).toEqual([
    "type",
    "version",
    "$",
    "children",
  ]);
});

test("says how every registered node sits in a document, and which field decides it where one does", () => {
  const registered = [
    ...createHeadlessEditor({ nodes: SCHEMA_NODES })._nodes.keys(),
  ].filter((type) => type !== ArtificialNode__DO_NOT_USE.getType());

  expect(Object.keys(schema.traits).sort()).toEqual(registered.sort());
  expect(schema.traits.paragraph).toEqual({
    kind: "element",
    inline: false,
    shadowRoot: false,
    canBeEmpty: true,
  });
  expect(schema.traits.link?.canBeEmpty).toBe(false);
  expect(schema.traits.callout?.canBeEmpty).toBe(false);
  expect(schema.traits.link).toMatchObject({ kind: "element", inline: true });
  expect(schema.traits.tablecell?.shadowRoot).toBe(true);
  expect(schema.traits["code-highlight"]?.kind).toBe("text");
  expect(schema.traits.linebreak?.kind).toBe("linebreak");
  expect(schema.traits.image).toMatchObject({
    kind: "decorator",
    inline: true,
  });
  expect(schema.traits.youtube?.inline).toBe(false);
  expect(schema.traits.equation?.inline).toEqual({ field: "inline" });
  expect(schema.traits.quote?.shadowRoot).toEqual({ field: "shadowRoot" });
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
