import {
  $create,
  ArtificialNode__DO_NOT_USE,
  $isElementNode,
  type AnySerializationSchema,
  createEditor,
  getComposedSchemaFields,
  getStaticNodeConfig,
  iterStaticNodeConfigChain,
  type Klass,
  type LexicalNode,
} from "lexical";

/**
 * The language-neutral description of every node the editor registers: the
 * stored-format contract other implementations (LexicalSwift) are generated
 * from. `bun run node-schema` rewrites the committed copy.
 */
export type NodeSchema = {
  nodes: NodeDescription[];
  /** Types whose JSON isn't declared yet, so no other side can type them. */
  undeclared: string[];
};

export type NodeDescription = {
  type: string;
  /** The Lexical class, e.g. `ListItemNode`, for naming it elsewhere. */
  className: string;
  /** What Lexical writes as `version`; it never reads it back. */
  version: number;
  children: boolean;
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
  | { kind: "raw" }
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
  | { kind: "object"; fields: Record<string, FieldType> }
  | { kind: "transform"; inner: FieldType }
);

export const NODE_SCHEMA_URL = new URL("../node-schema.json", import.meta.url);

/** The committed file's exact text for `schema`. */
export function nodeSchemaFile(schema: NodeSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/** Properties every node writes that aren't its schema's fields. */
const ENVELOPE = new Set(["type", "version", "children", "$", "$slots"]);

/**
 * Describes every node registered alongside `nodes`. A node is declared when
 * its class states its JSON through `$config`, which is how Lexical's own
 * nodes do it; the rest are listed as undeclared.
 */
export function exportNodeSchema(nodes: Klass<LexicalNode>[]): NodeSchema {
  const editor = createEditor({
    nodes,
    onError: (error) => {
      throw error;
    },
  });
  const described: NodeDescription[] = [];
  const undeclared: string[] = [];
  for (const [type, { klass }] of editor._nodes) {
    // Lexical registers it in every editor, but it never reaches stored JSON.
    if (klass === ArtificialNode__DO_NOT_USE) continue;
    if (getStaticNodeConfig(klass).declaresOwnConfig) {
      editor.update(() => described.push(describe(type, klass)), {
        discrete: true,
      });
    } else {
      undeclared.push(type);
    }
  }
  return {
    nodes: described.sort((a, b) => byCodeUnits(a.type, b.type)),
    undeclared: undeclared.sort(byCodeUnits),
  };
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
    if (!(key in state)) fields[key] = fieldType(schema);
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
  // Lexical's production build minifies class names.
  if (!/^[A-Z][A-Za-z0-9]*Node$/.test(klass.name)) {
    throw new Error(
      `${type}'s class is called ${klass.name}; export with Lexical's development build`,
    );
  }
  return {
    type,
    className: klass.name,
    version: written.version,
    children: $isElementNode(created),
    fields,
    state,
  };
}

function fieldType(schema: AnySerializationSchema): FieldType {
  const withDefault = (type: FieldType): FieldType =>
    schema.defaultValue === undefined
      ? type
      : { ...type, default: schema.defaultValue as JSONValue };
  const { meta } = schema;
  switch (meta.kind) {
    case "string":
    case "boolean":
    case "raw":
      return withDefault({ kind: meta.kind });
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
      return withDefault({ kind: meta.kind, item: fieldType(meta.item) });
    case "nullable":
      return withDefault(
        definedOnly({
          kind: meta.kind,
          inner: fieldType(meta.inner),
          defaultAsNull: meta.defaultAsNull,
        }),
      );
    case "optional":
      return withDefault(
        definedOnly({
          kind: meta.kind,
          inner: fieldType(meta.inner),
          omitDefault: meta.omitDefault,
        }),
      );
    case "aliased":
      return withDefault({
        kind: meta.kind,
        inner: fieldType(meta.inner),
        aliases: { ...meta.aliases } as Record<string, JSONValue>,
      });
    case "union":
      return withDefault({
        kind: meta.kind,
        members: meta.members.map(fieldType),
      });
    case "object":
      return withDefault({
        kind: meta.kind,
        fields: Object.fromEntries(
          sortedEntries(meta.fields).map(([key, field]) => [
            key,
            fieldType(field),
          ]),
        ),
      });
    case "transform":
      return withDefault({ kind: meta.kind, inner: fieldType(meta.inner) });
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
