import {
  type AnySerializationSchema,
  getComposedSchemaFields,
  iterStaticNodeConfigChain,
  type Klass,
  type LexicalNode,
  type LexicalParseJSON,
  type SchemaInput,
  type SerializationSchema,
  type SerializationSchemaFields,
  type SerializationSchemaValue,
  type SerializedLexicalNode,
} from "lexical";
import { annotationsOf } from "./schema-values.js";

/**
 * In {@link storedFields}, a key the node writes at that place that isn't one
 * of its own fields: `type`, `version`, its NodeState under `$`, `children`,
 * or a field of the class it extends.
 */
export const written = Symbol("written");

type Written = typeof written;

type StoredFieldsInput = {
  readonly [key: string]: AnySerializationSchema | Written;
};

type Declared<F> = {
  [K in keyof F as F[K] extends Written ? never : K]: F[K];
};

/** A node's fields as the values they write, which name nothing of the node. */
type Values<F> = {
  [K in keyof Declared<F>]: SerializationSchema<
    SerializationSchemaValue<F[K]>,
    unknown,
    SchemaInput<F[K]>
  >;
};

const ORDERS = new WeakMap<SerializationSchemaFields, readonly string[]>();

/**
 * A node's schema fields, declared in the order it writes its JSON, which is
 * the order it has always written it in: a document is compared as a string
 * when it's saved. `fields` is for `nodeSchema`, and `json` is the same
 * fields typed as the values they write, for the node's serialized type.
 *
 * A node that doesn't place `$` neither reads nor writes NodeState, and a
 * node that places `children` but holds none writes them as an empty list.
 * {@link withStoredJSON} gives a class the methods that do so.
 */
export function storedFields<F extends StoredFieldsInput>(
  declared: F,
): { fields: Declared<F>; json: Values<F> } {
  const fields: Record<string, AnySerializationSchema> = {};
  for (const [key, field] of Object.entries(declared)) {
    if (field !== written) fields[key] = field;
  }
  ORDERS.set(fields, Object.keys(declared));
  return { fields, json: fields } as { fields: Declared<F>; json: Values<F> };
}

/**
 * The order `klass` writes its JSON in, from the {@link storedFields} nearest
 * it, or undefined where its JSON is Lexical's own.
 */
export function writtenOrder(
  klass: Klass<LexicalNode>,
): readonly string[] | undefined {
  for (const { ownNodeConfig } of iterStaticNodeConfigChain(klass)) {
    if (ownNodeConfig?.json) return ORDERS.get(ownNodeConfig.json.meta.fields);
  }
  return undefined;
}

type StoredForm = {
  order: readonly string[];
  keepsState: boolean;
  /** Fields read as their annotation says where the JSON holds NodeState. */
  checkedWithState: [string, AnySerializationSchema][];
};

function storedForm(klass: Klass<LexicalNode>): StoredForm {
  const order = writtenOrder(klass);
  if (!order) {
    throw new Error(`${klass.name} declares its JSON without storedFields`);
  }
  const checkedWithState: StoredForm["checkedWithState"] = [];
  for (const [key, field] of Object.entries(getComposedSchemaFields(klass))) {
    const check = annotationsOf(field.meta).checkedWithState;
    if (check) checkedWithState.push([key, check]);
  }
  return { order, keepsState: order.includes("$"), checkedWithState };
}

function inWrittenOrder(
  json: Record<string, unknown>,
  order: readonly string[],
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of order) {
    const value = key === "children" ? (json.children ?? []) : json[key];
    if (value !== undefined) ordered[key] = value;
  }
  // Anything Lexical writes that the order doesn't place, but NodeState,
  // which a node that doesn't place it never kept.
  for (const [key, value] of Object.entries(json)) {
    if (!(key in ordered) && key !== "$" && value !== undefined) {
      ordered[key] = value;
    }
  }
  return ordered;
}

function asRead(
  { keepsState, checkedWithState }: StoredForm,
  json: LexicalParseJSON<SerializedLexicalNode>,
): LexicalParseJSON<SerializedLexicalNode> {
  if (!keepsState) {
    const { $: _dropped, ...read } = json;
    return read;
  }
  if (!json.$ || checkedWithState.length === 0) return json;
  const read: Record<string, unknown> = { ...json };
  for (const [key, check] of checkedWithState) read[key] = check(read[key]);
  return read;
}

/**
 * Gives `klass` the `exportJSON` and `updateFromJSON` that write and read its
 * JSON as its {@link storedFields} declare, around the ones it inherits.
 */
export function withStoredJSON<T extends Klass<LexicalNode>>(klass: T): T {
  const inherited: LexicalNode = Object.getPrototypeOf(klass.prototype);
  let form: StoredForm | undefined;
  const formOf = () => {
    form ??= storedForm(klass);
    return form;
  };
  Object.assign(klass.prototype, {
    exportJSON(this: LexicalNode, compact = false) {
      return inWrittenOrder(
        inherited.exportJSON.call(this, compact),
        formOf().order,
      );
    },
    updateFromJSON(
      this: LexicalNode,
      json: LexicalParseJSON<SerializedLexicalNode>,
    ) {
      return inherited.updateFromJSON.call(this, asRead(formOf(), json));
    },
  });
  return klass;
}

/** A node class's `importJSON`, which Lexical gives it, typed as the class. */
export type ImportJSON<N extends LexicalNode> = (
  json: Parameters<typeof LexicalNode.importJSON>[0],
) => N;
