import {
  enumValue,
  type InnerSerializationSchemaFields,
  type LexicalEditor,
  numberValue,
  objectValue,
  rawValue,
  type SerializedEditor,
  type SerializationSchema,
  type SerializationSchemaMeta,
  type SerializationSchemaValue,
  transformValue,
  unionValue,
} from "lexical";

/**
 * Keyed by the meta, which `withField` and `withAccessors` carry over to the
 * schema they wrap; the schema object itself is a new one in each.
 */
const OPEN_OBJECTS = new WeakSet<SerializationSchemaMeta>();
const TRANSFORM_NAMES = new WeakMap<SerializationSchemaMeta, string>();

type JSONObject = { readonly [key: string]: unknown };

/** An open object's value: a field that can read as absent is optional. */
type OpenObject<S extends InnerSerializationSchemaFields> = {
  [K in keyof S as undefined extends SerializationSchemaValue<S[K]>
    ? never
    : K]: SerializationSchemaValue<S[K]>;
} & {
  [K in keyof S as undefined extends SerializationSchemaValue<S[K]>
    ? K
    : never]?: SerializationSchemaValue<S[K]>;
} & JSONObject;

/**
 * Lexical's `objectValue`, but keeping the keys it doesn't declare as they
 * are: for data a node stored whole before it had a schema, where reading it
 * mustn't lose what an older or newer writer put there.
 *
 * The declared `accepts` is what makes a union measure it by its declared
 * fields alone, rather than turn it down for carrying keys it keeps.
 */
export function openObjectValue<const S extends InnerSerializationSchemaFields>(
  fields: S,
): SerializationSchema<OpenObject<S>, never, unknown> {
  const declared = objectValue(fields);
  const schema = Object.assign(
    (value: unknown) =>
      isPlainObject(value) ? { ...value, ...declared(value) } : declared(value),
    {
      accepts: isPlainObject,
      defaultValue: declared.defaultValue,
      isEqual: sameJSON,
      meta: declared.meta,
    },
  );
  OPEN_OBJECTS.add(declared.meta);
  return schema as unknown as SerializationSchema<
    OpenObject<S>,
    never,
    unknown
  >;
}

export function isOpenObject(meta: SerializationSchemaMeta): boolean {
  return OPEN_OBJECTS.has(meta);
}

/**
 * Lexical's `transformValue` for a check or normalisation that keeps a value
 * in its type or turns it down as absent, under a name other implementations
 * give their own copy of it by: the function itself can't be described.
 */
export function namedTransform<T, Out extends T | undefined, In = T>(
  name: string,
  inner: SerializationSchema<T, never, In>,
  transform: (value: T) => Out,
): SerializationSchema<Out, never, In> {
  const schema = transformValue(inner, transform);
  TRANSFORM_NAMES.set(schema.meta, name);
  return schema;
}

export function transformName(
  meta: SerializationSchemaMeta,
): string | undefined {
  return TRANSFORM_NAMES.get(meta);
}

/** A size in pixels, or `inherit` for the size of what holds it. */
export const dimensionValue = unionValue(
  [numberValue(), enumValue(["inherit"])],
  "inherit",
);

export type Dimension = SerializationSchemaValue<typeof dimensionValue>;

/** A dimension that older documents stored unset as 0. */
export const zeroAsInheritValue = namedTransform(
  "zeroAsInherit",
  dimensionValue,
  (value): Dimension => (value === 0 ? "inherit" : value),
);

/**
 * The number images, video and YouTube embeds store a dimension as, which is
 * 0 for `inherit`.
 */
export function zeroForInherit(value: Dimension): number {
  return value === "inherit" ? 0 : value;
}

/** The dimension {@link zeroForInherit} stored. */
export function inheritForZero(value: number): Dimension {
  return value || "inherit";
}

/** Lexical's `rawValue`, but reading absence as `defaultValue`. */
export function rawValueOr<T>(
  defaultValue: T,
): SerializationSchema<T, never, unknown> {
  return Object.assign(
    (value: unknown) => (value === undefined ? defaultValue : value),
    { ...rawValue<T>(), defaultValue },
  ) as SerializationSchema<T, never, unknown>;
}

type EditorStateJSON = SerializedEditor["editorState"];

/** What an editor with nothing in it writes. */
const EMPTY_EDITOR_STATE: EditorStateJSON = {
  root: {
    children: [],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
};

/**
 * A nested editor's JSON, as `LexicalEditor.toJSON` writes it. A node writes
 * the editor it holds whatever it read, so JSON without one reads as the
 * empty editor it will write.
 */
export const nestedEditorValue = objectValue({
  editorState: rawValueOr(EMPTY_EDITOR_STATE),
});

export type NestedEditorJSON = SerializationSchemaValue<
  typeof nestedEditorValue
>;

/**
 * Reads a nested editor's JSON into `editor`. JSON that holds nothing leaves
 * the editor as it was made.
 */
export function setNestedEditorJSON(
  editor: LexicalEditor,
  { editorState }: NestedEditorJSON,
): void {
  if (!editorState) return;
  const state = editor.parseEditorState(editorState);
  if (!state.isEmpty()) editor.setEditorState(state);
}

function isPlainObject(value: unknown): value is JSONObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameJSON(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJSON(item, b[index]))
    );
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length ===
      Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => sameJSON(a[key], b[key]))
  );
}
