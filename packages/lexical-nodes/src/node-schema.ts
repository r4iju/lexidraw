import {
  $create,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  $parseSerializedNode,
  ArtificialNode__DO_NOT_USE,
  type AnySerializationSchema,
  createEditor,
  getComposedSchemaFields,
  getStaticNodeConfig,
  iterStaticNodeConfigChain,
  type Klass,
  type LexicalNode,
} from "lexical";
import {
  checkOf,
  isWrittenOnly,
  readsNullAsAbsent,
  shapeOf,
  transformName,
} from "./schema-values.js";

/**
 * The language-neutral description of every node the editor registers: the
 * stored-format contract other implementations (LexicalSwift) are generated
 * from. `bun run node-schema` rewrites the committed copy.
 */
export type NodeSchema = {
  nodes: NodeDescription[];
  /** How each registered node sits in a document. */
  traits: Record<string, NodeTraits>;
};

/**
 * What Lexical's own normalization asks of a node, so another side can keep
 * a document's shape without knowing the node's JSON.
 */
export type NodeTraits = {
  kind: "element" | "text" | "linebreak" | "decorator";
  /** Sits in a line of text, so it is wrapped in a paragraph at a root. */
  inline: Trait;
  /** Holds blocks the way the root does, as a table cell does. */
  shadowRoot: Trait;
  /** An element that stays when its last child goes. */
  canBeEmpty: Trait;
};

/** A fixed answer, or the boolean property a node reads it from. */
export type Trait = boolean | { field: string };

export type NodeDescription = {
  type: string;
  /** The Lexical class, e.g. `ListItemNode`, for naming it elsewhere. */
  className: string;
  /** What Lexical writes as `version`; it never reads it back. */
  version: number;
  /** Whether it writes `children`: every element, and a few that don't hold any. */
  children: boolean;
  /**
   * Whether it writes back the NodeState it was read with, under `$`, where
   * Lexical reads it as an object's properties: a string's characters, an
   * array's items, nothing of a number. Some nodes read none.
   */
  keepsState: boolean;
  fields: Record<string, FieldType>;
  /** NodeState, written flat beside the fields or nested under `$`. */
  state: Record<string, { flat: boolean; value: FieldType }>;
};

type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * Lexical's schema meta, as JSON. `default` is what reading an absent or
 * out-of-domain value gives; it is left out where that is absence.
 */
export type FieldType = { default?: JSONValue } & (
  | { kind: "string" }
  | { kind: "boolean" }
  | {
      kind: "raw";
      /** Reads null as it reads absence, as the default. */
      nullAsAbsent?: true;
      /** What the value is, where it reads back as itself. */
      shape?: FieldType;
      /** How the value is read where the node holds NodeState. */
      withState?: FieldType;
    }
  | {
      /**
       * Written as the node holds it, and never read: a node read from JSON
       * holds the default. A gated one is written only where it isn't.
       */
      kind: "unread";
      inner: FieldType;
      gated?: true;
    }
  | {
      kind: "number";
      min?: number;
      max?: number;
      integer?: boolean;
      clamp?: boolean;
    }
  | { kind: "enum"; values: JSONValue[] }
  | { kind: "array"; item: FieldType }
  | { kind: "nullable"; inner: FieldType; defaultAsNull?: boolean }
  | { kind: "optional"; inner: FieldType; omitDefault?: boolean }
  | { kind: "aliased"; inner: FieldType; aliases: Record<string, JSONValue> }
  | { kind: "union"; members: FieldType[] }
  | {
      kind: "object";
      fields: Record<string, FieldType>;
      /**
       * Keeps the keys it doesn't declare, and a union doesn't count them:
       * an object in a value kept as stored.
       */
      open?: true;
    }
  | { kind: "transform"; inner: FieldType; name?: string }
);

export const NODE_SCHEMA_URL = new URL("../node-schema.json", import.meta.url);

/** The committed file's exact text for `schema`. */
export function nodeSchemaFile(schema: NodeSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/** Properties every node writes that aren't its schema's fields. */
const ENVELOPE = new Set(["type", "version", "children", "$", "$slots"]);

/**
 * Describes every node registered alongside `nodes`. Each must state its JSON
 * through `$config`, as Lexical's own nodes do: a node that doesn't would be
 * one no other side can read.
 */
export function exportNodeSchema(nodes: Klass<LexicalNode>[]): NodeSchema {
  const editor = createEditor({
    nodes,
    onError: (error) => {
      throw error;
    },
  });
  const described: NodeDescription[] = [];
  const traits: Record<string, NodeTraits> = {};
  for (const [type, { klass }] of editor._nodes) {
    // Lexical registers it in every editor, but it never reaches stored JSON.
    if (klass === ArtificialNode__DO_NOT_USE) continue;
    if (!getStaticNodeConfig(klass).declaresOwnConfig) {
      throw new Error(
        `${type}: ${klass.name} doesn't declare its JSON through $config`,
      );
    }
    editor.update(
      () => {
        const description = describe(type, klass);
        described.push(description);
        traits[type] = describeTraits(klass, declaredBooleans(description));
      },
      { discrete: true },
    );
  }
  return {
    nodes: described.sort((a, b) => byCodeUnits(a.type, b.type)),
    traits: Object.fromEntries(
      Object.entries(traits).sort(([a], [b]) => byCodeUnits(a, b)),
    ),
  };
}

function describeTraits(
  klass: Klass<LexicalNode>,
  declaredBooleans: string[],
): NodeTraits {
  const created = $create(klass);
  const kind = $isElementNode(created)
    ? "element"
    : $isTextNode(created)
      ? "text"
      : $isLineBreakNode(created)
        ? "linebreak"
        : $isDecoratorNode(created)
          ? "decorator"
          : null;
  if (!kind)
    throw new Error(`${klass.getType()} is no kind of node Lexical has`);
  const serialized = created.exportJSON();
  const written: Record<string, unknown> = serialized;
  const booleans = new Set([
    ...declaredBooleans,
    ...Object.keys(written).filter((key) => typeof written[key] === "boolean"),
  ]);
  // A trait a node reads off its own properties shows up as the one boolean
  // property that turns it when flipped.
  const trait = (name: string, read: (node: LexicalNode) => boolean): Trait => {
    const fixed = read(created);
    for (const key of [...booleans].sort(byCodeUnits)) {
      const value = written[key] === true;
      const flipped = klass.importJSON({ ...serialized, [key]: !value });
      if (read(flipped) === fixed) continue;
      if (fixed !== value) {
        throw new Error(
          `${klass.getType()}: ${name} follows "${key}" but isn't its value`,
        );
      }
      return { field: key };
    }
    return fixed;
  };
  return {
    kind,
    inline: trait("isInline", (node) => node.isInline()),
    shadowRoot: trait(
      "isShadowRoot",
      (node) => $isElementNode(node) && node.isShadowRoot(),
    ),
    canBeEmpty: trait(
      "canBeEmpty",
      (node) => $isElementNode(node) && node.canBeEmpty(),
    ),
  };
}

function declaredBooleans(description: NodeDescription): string[] {
  const isBoolean = (type: FieldType): boolean =>
    type.kind === "boolean" ||
    ((type.kind === "optional" || type.kind === "nullable") &&
      isBoolean(type.inner));
  return [
    ...Object.entries(description.fields).filter(([, type]) => isBoolean(type)),
    ...Object.entries(description.state)
      .filter(([, state]) => state.flat)
      .map(([key, state]) => [key, state.value] as const)
      .filter(([, type]) => isBoolean(type)),
  ].map(([key]) => key);
}

function describe(type: string, klass: Klass<LexicalNode>): NodeDescription {
  const state: NodeDescription["state"] = {};
  for (const { ownNodeConfig } of iterStaticNodeConfigChain(klass)) {
    for (const required of ownNodeConfig?.stateConfigs ?? []) {
      const [config, flat] =
        "stateConfig" in required
          ? [required.stateConfig, required.flat === true]
          : [required, false];
      if (typeof config.key !== "string" || config.key in state) continue;
      if (!config.schema) {
        throw new Error(
          `${type}: state "${config.key}" has no schema, so its JSON can't be described`,
        );
      }
      state[config.key] = { flat, value: fieldType(config.schema) };
    }
  }
  const fields: NodeDescription["fields"] = {};
  for (const [key, schema] of sortedEntries(getComposedSchemaFields(klass))) {
    if (!(key in state)) fields[key] = fieldOf(schema);
  }

  // The schema is Lexical's claim about the JSON; what a node actually writes
  // is the check on it.
  const created = $create(klass);
  const written = created.exportJSON();
  const extra = Object.keys(written).filter(
    (key) => !ENVELOPE.has(key) && !(key in fields) && !(key in state),
  );
  if (extra.length > 0) {
    throw new Error(
      `${type} writes ${extra.join(", ")}, which its schema doesn't declare`,
    );
  }
  // Some nodes' exportJSON leaves a field out while it holds its default,
  // which Lexical's schema says only of an `optional` with `omitDefault`.
  for (const [key, field] of Object.entries(fields)) {
    if (
      written[key as keyof typeof written] === undefined &&
      field.default !== undefined &&
      field.kind !== "optional"
    ) {
      fields[key] = { kind: "optional", inner: field, omitDefault: true };
    }
  }
  // Lexical's production build minifies class names.
  if (!/^[A-Z][A-Za-z0-9]*Node$/.test(klass.name)) {
    throw new Error(
      `${type}'s class is called ${klass.name}; export with Lexical's development build`,
    );
  }
  const read = $parseSerializedNode({ ...written, $: { probe: true } });
  return {
    type,
    className: klass.name,
    version: written.version,
    children: $isElementNode(created) || "children" in written,
    keepsState: "$" in read.exportJSON(),
    fields,
    state,
  };
}

/** A node's own field: as {@link fieldType}, or unread where it's written only. */
function fieldOf(schema: AnySerializationSchema): FieldType {
  if (!isWrittenOnly(schema.meta)) return fieldType(schema);
  const { getter } = schema;
  const gated = typeof getter === "object" && getter?.when !== undefined;
  return {
    kind: "unread",
    inner: fieldType(schema),
    ...(gated ? { gated: true } : {}),
  };
}

function fieldType(schema: AnySerializationSchema, stored = false): FieldType {
  const described = (inner: AnySerializationSchema) => fieldType(inner, stored);
  const withDefault = (type: FieldType): FieldType =>
    schema.defaultValue === undefined
      ? type
      : { ...type, default: schema.defaultValue as JSONValue };
  const { meta } = schema;
  switch (meta.kind) {
    case "string":
    case "boolean":
      return withDefault({ kind: meta.kind });
    case "raw": {
      const shape = shapeOf(meta);
      const withState = checkOf(meta);
      return withDefault({
        kind: meta.kind,
        ...(readsNullAsAbsent(meta) ? { nullAsAbsent: true } : {}),
        ...(shape ? { shape: fieldType(shape, true) } : {}),
        ...(withState ? { withState: described(withState) } : {}),
      });
    }
    case "number":
      return withDefault(
        definedOnly({
          kind: meta.kind,
          min: meta.min,
          max: meta.max,
          integer: meta.integer,
          clamp: meta.clamp,
        }),
      );
    case "enum":
      return withDefault({
        kind: meta.kind,
        values: meta.values.filter(
          (value) => value !== undefined,
        ) as JSONValue[],
      });
    case "array":
      return withDefault({ kind: meta.kind, item: described(meta.item) });
    case "nullable":
      return withDefault(
        definedOnly({
          kind: meta.kind,
          inner: described(meta.inner),
          defaultAsNull: meta.defaultAsNull,
        }),
      );
    case "optional":
      return withDefault(
        definedOnly({
          kind: meta.kind,
          inner: described(meta.inner),
          omitDefault: meta.omitDefault,
        }),
      );
    case "aliased":
      return withDefault({
        kind: meta.kind,
        inner: described(meta.inner),
        aliases: { ...meta.aliases } as Record<string, JSONValue>,
      });
    case "union":
      return withDefault({
        kind: meta.kind,
        members: meta.members.map(described),
      });
    case "object":
      return withDefault({
        kind: meta.kind,
        fields: Object.fromEntries(
          sortedEntries(meta.fields).map(([key, field]) => [
            key,
            described(field),
          ]),
        ),
        ...(stored ? { open: true } : {}),
      });
    case "transform":
      return withDefault(
        definedOnly({
          kind: meta.kind,
          name: transformName(meta),
          inner: described(meta.inner),
        }),
      );
  }
}

function definedOnly<T extends object>(object: T): T {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as T;
}

function sortedEntries<T>(record: Readonly<Record<string, T>>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => byCodeUnits(a, b));
}

/** Code-unit order, so generated files don't depend on locale. */
export function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
