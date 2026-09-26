import { fileURLToPath } from "node:url";
import type {
  FieldType,
  NodeDescription,
  NodeSchema,
} from "@packages/lexical-nodes/node-schema";

export const SERIALIZED_NODES_PATH = fileURLToPath(
  new URL("../Sources/LexicalSwift/SerializedNodes.swift", import.meta.url),
);

/**
 * Enum type names where a field's name doesn't give one: the field takes
 * different values on different nodes, or the name alone would be vague.
 * Keyed by the enum's non-null values.
 */
const ENUM_NAMES: Record<string, string> = {
  [key(["", "left", "start", "center", "right", "end", "justify"])]:
    "ElementFormat",
  [key(["normal", "token", "segmented"])]: "TextMode",
  [key(["normal"])]: "TabMode",
  [key(["h1", "h2", "h3", "h4", "h5", "h6"])]: "HeadingTag",
  [key(["ul", "ol"])]: "ListTag",
};

/** Names a payload's own members take, which no field may reuse. */
const RESERVED_MEMBERS = new Set(["children", "json", "type", "unknownFields"]);

const SWIFT_KEYWORDS = new Set(
  "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private precedencegroup protocol public rethrows static struct subscript typealias var break case catch continue default defer do else fallthrough for guard if in repeat return throw switch where while Any as await false is nil self Self super throws true try".split(
    " ",
  ),
);

/** The Swift payload types for every declared node in `schema`. */
export function swiftForNodeSchema(schema: NodeSchema): string {
  const enums = enumNames(schema.nodes);
  const context = { enums };
  const lines = [
    "// Generated from packages/lexical-nodes/node-schema.json by apps/ios/codegen.",
    "// Don't edit it; run `bun run codegen` in apps/ios.",
    "",
    ...serializedNode(schema.nodes),
    ...[...new Set(enums.values())]
      .sort()
      .flatMap((name) => enumeration(name, enums)),
    ...schema.nodes.flatMap((node) => payload(node, context)),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

type Context = { enums: Map<string, string> };

function serializedNode(nodes: NodeDescription[]): string[] {
  const cases = nodes.map((node) => ({
    name: identifier(camelCase(node.type)),
    payload: payloadName(node.type),
    type: node.type,
  }));
  if (cases.some(({ name }) => name === "opaque")) {
    throw new Error("A node type can't be called opaque");
  }
  return [
    "public enum SerializedNode: Equatable, Sendable {",
    ...cases.map(({ name, payload }) => `  case ${name}(${payload})`),
    "  /// A node whose type isn't declared, kept exactly as read.",
    "  case opaque(JSONValue)",
    "",
    "  public init(json: JSONValue) {",
    '    switch json["type"]?.stringValue {',
    ...cases.map(
      ({ name, type }) =>
        `    case ${swiftString(type)}: self.init(json, as: Self.${name})`,
    ),
    "    default: self = .opaque(json)",
    "    }",
    "  }",
    "",
    "  public var payload: (any NodePayload)? {",
    "    switch self {",
    ...cases.map(({ name }) => `    case .${name}(let node): node`),
    "    case .opaque: nil",
    "    }",
    "  }",
    "",
    "  public var json: JSONValue {",
    "    switch self {",
    ...cases.map(({ name }) => `    case .${name}(let node): node.json`),
    "    case .opaque(let json): json",
    "    }",
    "  }",
    "}",
    "",
  ];
}

function enumeration(name: string, enums: Map<string, string>): string[] {
  const values = [...enums.entries()].find(([, n]) => n === name)?.[0];
  const cases = (JSON.parse(values ?? "[]") as string[]).map((value) => {
    const caseName = value === "" ? "empty" : identifier(camelCase(value));
    return caseName === value
      ? `  case ${caseName}`
      : `  case ${caseName} = ${swiftString(value)}`;
  });
  return [
    `public enum ${name}: String, CaseIterable, Sendable, JSONEnumeration {`,
    ...cases,
    "}",
    "",
  ];
}

function payload(node: NodeDescription, context: Context): string[] {
  const name = payloadName(node.type);
  const fields = [
    ...Object.entries(node.fields),
    ...Object.entries(node.state).map(([key, state]) => {
      if (!state.flat) {
        throw new Error(
          `${node.type}: state "${key}" nests under "$", which codegen doesn't type yet`,
        );
      }
      return [key, state.value] as const;
    }),
  ]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, type]) => {
      if (RESERVED_MEMBERS.has(key)) {
        throw new Error(`${node.type}: a field can't be called ${key}`);
      }
      const swift = swiftField(type, context, `${node.type}.${key}`);
      return {
        key,
        property: identifier(key),
        schemaName: identifier(key),
        ...swift,
      };
    });
  return [
    `public struct ${name}: ${node.children ? "ElementNodePayload" : "NodePayload"} {`,
    `  public static let type = ${swiftString(node.type)}`,
    ...(node.children ? ["  public var children: [SerializedNode]?"] : []),
    ...fields.map(({ property, type }) => `  public var ${property}: ${type}?`),
    "  public var unknownFields: [String: JSONValue]",
    "",
    "  public init(json: JSONValue) throws {",
    "    var fields = try NodeFields(reading: json, as: Self.type)",
    ...(node.children ? ["    children = fields.takeChildren()"] : []),
    ...fields.map(
      ({ key, property, schemaName }) =>
        `    ${property} = fields.take(${swiftString(key)}, Schema.${schemaName})`,
    ),
    "    unknownFields = fields.rest",
    "  }",
    "",
    "  public var json: JSONValue {",
    "    var fields = NodeFields(writing: Self.type, over: unknownFields)",
    ...(node.children ? ["    fields.putChildren(children)"] : []),
    ...fields.map(
      ({ key, property, schemaName }) =>
        `    fields.put(${swiftString(key)}, ${property}, Schema.${schemaName})`,
    ),
    "    return fields.json",
    "  }",
    ...(fields.length > 0
      ? [
          "",
          "  private enum Schema {",
          ...fields.map(
            ({ schemaName, type, schema }) =>
              `    static let ${schemaName}: FieldSchema<${type}> = ${schema}`,
          ),
          "  }",
        ]
      : []),
    "}",
    "",
  ];
}

/** A field's Swift value type and the `FieldSchema` expression that reads it. */
function swiftField(
  type: FieldType,
  context: Context,
  where: string,
): { type: string; schema: string } {
  switch (type.kind) {
    case "string":
      return {
        type: "String",
        schema: `.string(default: ${literal(required(type.default, where), type, context)})`,
      };
    case "boolean":
      return {
        type: "Bool",
        schema: `.boolean(default: ${literal(required(type.default, where), type, context)})`,
      };
    case "number": {
      const options = [
        `default: ${literal(required(type.default, where), type, context)}`,
        ...(type.min === undefined ? [] : [`min: ${type.min}`]),
        ...(type.max === undefined ? [] : [`max: ${type.max}`]),
        ...(type.clamp ? ["clamp: true"] : []),
      ].join(", ");
      return type.integer
        ? { type: "Int", schema: `.integer(${options})` }
        : { type: "Double", schema: `.number(${options})` };
    }
    case "enum": {
      const name = enumName(type, context, where);
      const valueType = type.values.includes(null) ? `${name}?` : name;
      const fallback =
        type.default === undefined
          ? "nil"
          : type.default === null
            ? `${name}?.none`
            : literal(type.default, type, context);
      return {
        type: valueType,
        schema: `.enumeration(default: ${fallback})`,
      };
    }
    case "nullable": {
      const inner = swiftField(type.inner, context, where);
      return {
        type: `${inner.type}?`,
        schema: `.nullable(${inner.schema}${type.defaultAsNull ? ", defaultAsNull: true" : ""})`,
      };
    }
    case "optional": {
      const inner = swiftField(type.inner, context, where);
      return {
        type: inner.type,
        schema: `.optional(${inner.schema}${type.omitDefault ? ", omitDefault: true" : ""})`,
      };
    }
    case "aliased": {
      const inner = swiftField(type.inner, context, where);
      const aliases = Object.entries(type.aliases)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(
          ([alias, value]) =>
            `${swiftString(alias)}: ${literal(value, type.inner, context)}`,
        )
        .join(", ");
      return {
        type: inner.type,
        schema: `.aliased(${inner.schema}, [${aliases}])`,
      };
    }
    case "array": {
      if (readsAsAbsent(type.item)) {
        throw new Error(`${where}: an array item can't read as absent`);
      }
      const item = swiftField(type.item, context, where);
      return { type: `[${item.type}]`, schema: `.array(${item.schema})` };
    }
    default:
      throw new Error(`${where}: codegen doesn't type ${type.kind} fields yet`);
  }
}

function readsAsAbsent(type: FieldType): boolean {
  switch (type.kind) {
    case "optional":
    case "raw":
      return true;
    case "enum":
      return type.default === undefined;
    case "nullable":
    case "aliased":
    case "transform":
      return readsAsAbsent(type.inner);
    default:
      return false;
  }
}

/** A JSON value as a Swift literal of `type`'s value type. */
function literal(value: unknown, type: FieldType, context: Context): string {
  switch (type.kind) {
    case "string":
      return swiftString(value as string);
    case "boolean":
    case "number":
      return String(value);
    case "enum":
      return value === null
        ? "nil"
        : `${enumName(type, context, "")}.${value === "" ? "empty" : identifier(camelCase(value as string))}`;
    case "nullable":
      return value === null ? "nil" : literal(value, type.inner, context);
    case "optional":
    case "aliased":
      return literal(value, type.inner, context);
    case "array":
      return `[${(value as unknown[]).map((item) => literal(item, type.item, context)).join(", ")}]`;
    default:
      throw new Error(`No Swift literal for a ${type.kind} value`);
  }
}

function required<T>(value: T | undefined, where: string): T {
  if (value === undefined) throw new Error(`${where} has no default`);
  return value;
}

/** Every enum's Swift name, by its non-null values. */
function enumNames(nodes: NodeDescription[]): Map<string, string> {
  const byValues = new Map<string, Set<string>>();
  const visit = (type: FieldType, field: string) => {
    switch (type.kind) {
      case "enum": {
        const values = key(type.values);
        byValues.set(values, (byValues.get(values) ?? new Set()).add(field));
        return;
      }
      case "nullable":
      case "optional":
      case "aliased":
      case "transform":
        return visit(type.inner, field);
      case "array":
        return visit(type.item, field);
    }
  };
  for (const node of nodes) {
    for (const [field, type] of Object.entries(node.fields)) visit(type, field);
    for (const [field, state] of Object.entries(node.state)) {
      visit(state.value, field);
    }
  }
  const names = new Map<string, string>();
  for (const [values, fields] of byValues) {
    const named = ENUM_NAMES[values];
    if (!named && fields.size > 1) {
      throw new Error(
        `The enum ${values} is used by ${[...fields].join(", ")}; name it in ENUM_NAMES`,
      );
    }
    names.set(values, named ?? pascalCase([...fields][0] ?? ""));
  }
  const taken = new Map<string, string>();
  for (const [values, name] of names) {
    const other = taken.get(name);
    if (other !== undefined) {
      throw new Error(
        `The enums ${other} and ${values} would both be ${name}; name them in ENUM_NAMES`,
      );
    }
    taken.set(name, values);
  }
  return names;
}

function enumName(
  type: Extract<FieldType, { kind: "enum" }>,
  context: Context,
  where: string,
): string {
  const name = context.enums.get(key(type.values));
  if (!name) throw new Error(`${where}: an enum without a name`);
  return name;
}

function key(values: unknown[]): string {
  const members = values.filter((value) => value !== null);
  if (members.some((value) => typeof value !== "string")) {
    throw new Error(
      `Codegen only types enums of strings, not ${JSON.stringify(values)}`,
    );
  }
  return JSON.stringify(members);
}

function payloadName(type: string): string {
  return `Serialized${pascalCase(type)}Node`;
}

function pascalCase(name: string): string {
  const camel = camelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function camelCase(name: string): string {
  return name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    (next ?? "").toUpperCase(),
  );
}

function identifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${JSON.stringify(name)} isn't a Swift identifier`);
  }
  return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

function swiftString(value: string): string {
  let escaped = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    escaped +=
      char === "\\" || char === '"'
        ? `\\${char}`
        : char === "\n"
          ? "\\n"
          : char === "\r"
            ? "\\r"
            : char === "\t"
              ? "\\t"
              : code < 0x20
                ? `\\u{${code.toString(16)}}`
                : char;
  }
  return `"${escaped}"`;
}
