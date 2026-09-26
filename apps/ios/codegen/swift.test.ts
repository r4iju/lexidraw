import { expect, test } from "bun:test";
import {
  NODE_SCHEMA_URL,
  type NodeDescription,
} from "@packages/lexical-nodes/node-schema";
import { SERIALIZED_NODES_PATH, swiftForNodeSchema } from "./swift";

test("names each node's Swift type and case after its Lexical class", () => {
  const swift = swiftForNodeSchema({
    nodes: [
      {
        type: "horizontalrule",
        className: "HorizontalRuleNode",
        version: 1,
        children: false,
        fields: {},
        state: {},
      },
    ],
    traits: {},
  });

  expect(swift).toContain("case horizontalRule(SerializedHorizontalRuleNode)");
  expect(swift).toContain(
    'case "horizontalrule": self.init(json, as: Self.horizontalRule)',
  );
  expect(swift).toContain(
    "public struct SerializedHorizontalRuleNode: NodePayload {",
  );
});

test("the committed Swift payload types are a fresh codegen of the committed schema", async () => {
  const schema = await Bun.file(NODE_SCHEMA_URL).json();
  const committed = await Bun.file(SERIALIZED_NODES_PATH).text();
  expect(committed).toBe(swiftForNodeSchema(schema));
});

const marker = {
  type: "marker",
  className: "MarkerNode",
  version: 1,
  children: true,
  fields: {
    board: {
      kind: "object",
      fields: { editorState: { kind: "raw" } },
      default: {},
    },
    note: {
      kind: "object",
      open: true,
      fields: {
        text: { kind: "string", default: "" },
        replies: {
          kind: "array",
          item: {
            kind: "object",
            open: true,
            fields: { votes: { kind: "number", default: 0 } },
            default: { votes: 0 },
          },
          default: [],
        },
      },
      default: { text: "", replies: [] },
    },
  },
  state: {
    figure: {
      flat: false,
      value: {
        kind: "optional",
        inner: {
          kind: "transform",
          name: "figureWidth",
          inner: { kind: "string", default: "" },
        },
      },
    },
  },
} satisfies NodeDescription;

test("an object is a struct named after its field, which keeps the keys it doesn't declare", () => {
  const swift = swiftForNodeSchema({ nodes: [marker], traits: {} });

  expect(swift).toContain("public struct Note: DeclaredObject {");
  expect(swift).toContain("  static let isOpen = true");
  expect(swift).toContain(
    '  static let defaultValue = Self(["replies": [], "text": ""])',
  );
  expect(swift).toContain("  public var replies: [Replies]?");
  expect(swift).toContain("public struct Board: DeclaredObject {");
  expect(swift).toContain("  static let isOpen = false");
  expect(swift).toContain("  public var editorState: JSONValue?");
  expect(swift).toContain("    static let note: FieldSchema<Note> = .object");
});

test("an object that doesn't keep the keys it doesn't declare drops them, as Lexical does", () => {
  const swift = swiftForNodeSchema({ nodes: [marker], traits: {} });
  const board = swift.slice(swift.indexOf("public struct Board"));
  const note = swift.slice(swift.indexOf("public struct Note"));

  expect(board).toContain("    unknownFields = [:]\n");
  expect(note).toContain("    unknownFields = fields.rest\n");
});

test("a transform reads through the Swift function of the same name", () => {
  const swift = swiftForNodeSchema({ nodes: [marker], traits: {} });

  expect(swift).toContain(
    '    static let figure: FieldSchema<String> = .optional(.transform(.string(default: ""), Transforms.figureWidth))',
  );
});

test("state nested under $ is read from there, beside the state it doesn't declare", () => {
  const swift = swiftForNodeSchema({ nodes: [marker], traits: {} });

  expect(swift).toContain("    var state = fields.takeState()");
  expect(swift).toContain('    figure = state.take("figure", Schema.figure)');
  expect(swift).toContain("    fields.putState(state)");
});

test("state is left out where it is its default, as Lexical leaves it out", () => {
  const swift = swiftForNodeSchema({
    nodes: [
      {
        ...marker,
        state: {
          ...marker.state,
          pinned: { flat: true, value: { kind: "boolean", default: false } },
        },
      },
    ],
    traits: {},
  });

  expect(swift).toContain(
    '    state.putUnlessDefault("figure", figure, Schema.figure)',
  );
  expect(swift).toContain(
    '    fields.putUnlessDefault("pinned", pinned, Schema.pinned)',
  );
  expect(swift).toContain('    fields.put("note", note, Schema.note)');
});

test("a node that writes children has them, element or not", () => {
  const swift = swiftForNodeSchema({ nodes: [marker], traits: {} });

  expect(swift).toContain(
    "public struct SerializedMarkerNode: ParentNodePayload {",
  );
});

test("objects that share a name have to be the same object", () => {
  const clash = {
    ...marker,
    type: "clash",
    className: "ClashNode",
    fields: {
      note: { kind: "object", fields: {}, default: {} },
    },
    state: {},
  } satisfies NodeDescription;

  expect(() => swiftForNodeSchema({ nodes: [marker, clash], traits: {} })).toThrow(/Note/);
});

test("a field that can only be null is a Never that is null or absent", () => {
  const swift = swiftForNodeSchema({
    nodes: [
      {
        type: "pin",
        className: "PinNode",
        version: 1,
        children: false,
        fields: { direction: { kind: "enum", values: [null], default: null } },
        state: {},
      },
    ],
    traits: {},
  });

  expect(swift).toContain("  public var direction: Nullable<Never>");
  expect(swift).toContain(
    "    static let direction: FieldSchema<Never?> = .enumeration(default: Never?.none)",
  );
  expect(swift).not.toContain("enum Never");
});

const sized = {
  type: "sized",
  className: "SizedNode",
  version: 1,
  children: false,
  fields: {
    size: {
      kind: "union",
      members: [
        { kind: "number", default: 0 },
        { kind: "enum", values: ["inherit"], default: "inherit" },
      ],
      default: "inherit",
    },
  },
  state: {},
} satisfies NodeDescription;

test("a union is an enum with a case for each member, in Lexical's order", () => {
  const swift = swiftForNodeSchema({ nodes: [sized], traits: {} });

  expect(swift).toContain("public enum Size: JSONUnion {");
  expect(swift).toContain("  case number(Double)");
  expect(swift).toContain("  case inherit");
  expect(swift).toContain("  static let defaultValue: Self? = .inherit");
  expect(swift).toContain(
    "    .member(.number(default: 0), Self.number, { if case .number(let value) = $0 { value } else { nil } }),",
  );
  expect(swift).toContain('    .literal("inherit", .inherit),');
  expect(swift).toContain("    static let size: FieldSchema<Size> = .union");
  // A member that is one value is a case, not an enum of its own.
  expect(swift).not.toContain("enum Inherit");
});

test("an object in a union is the case its one constant field names", () => {
  const link = (mode: string, key: string) => ({
    kind: "object" as const,
    open: true as const,
    fields: {
      mode: { kind: "enum" as const, values: [mode], default: mode },
      [key]: { kind: "string" as const, default: "" },
    },
    default: { mode, [key]: "" },
  });
  const swift = swiftForNodeSchema({
    nodes: [
      {
        ...sized,
        fields: {
          link: {
            kind: "union",
            members: [link("url", "url"), link("entity", "entityId")],
            default: { mode: "url", url: "" },
          },
        },
      },
    ],
    traits: {},
  });

  expect(swift).toContain("  case url(LinkUrl)");
  expect(swift).toContain("  case entity(LinkEntity)");
  expect(swift).toContain("public struct LinkUrl: DeclaredObject {");
  expect(swift).toContain("  public var mode: UrlMode?");
  expect(swift).toContain("public enum EntityMode: String");
  expect(swift).toContain(
    '  static let defaultValue: Self? = .url(LinkUrl(["mode": "url", "url": ""]))',
  );
});

test("an enum, a struct and a union can't share a name", () => {
  const board = {
    ...sized,
    type: "board",
    className: "BoardNode",
    fields: { board: { kind: "enum", values: ["a", "b"], default: "a" } },
  } satisfies NodeDescription;

  expect(() => swiftForNodeSchema({ nodes: [marker, board], traits: {} })).toThrow(/Board/);
});
