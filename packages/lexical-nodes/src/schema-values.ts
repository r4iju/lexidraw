import {
  type AnySerializationSchema,
  type EditorState,
  getComposedSchemaFields,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  objectValue,
  rawValue,
  type SerializationSchema,
  type SerializationSchemaFields,
  type SerializationSchemaMeta,
  type SerializationSchemaValue,
  type SerializedEditor,
  type SerializedEditorState,
  type SerializedRootNode,
  transformValue,
} from "lexical";

/**
 * What other implementations need to know about a value that its schema's
 * meta doesn't say.
 */
export type Annotations = {
  /** The name they give their own copy of a transform's function by. */
  transform?: string;
  /** Null reads as absence does, as the default. */
  nullAsAbsent?: true;
  /** What a value kept as stored is, where it reads back as itself. */
  shape?: AnySerializationSchema;
  /** How the value is read where the node holds NodeState. */
  checkedWithState?: AnySerializationSchema;
  /** Written as the node holds it, and never read. */
  writtenOnly?: true;
  /**
   * Makes the editor the node reads an editor state into, and writes it back
   * from as that editor saves it.
   */
  nestedEditor?: () => LexicalEditor;
};

/**
 * Keyed by the meta, which `withField` and `withAccessors` carry over to the
 * schema they wrap; the schema object itself is a new one in each.
 */
const ANNOTATIONS = new WeakMap<SerializationSchemaMeta, Annotations>();

function annotate(meta: SerializationSchemaMeta, annotations: Annotations) {
  ANNOTATIONS.set(meta, { ...ANNOTATIONS.get(meta), ...annotations });
}

export function annotationsOf(meta: SerializationSchemaMeta): Annotations {
  return ANNOTATIONS.get(meta) ?? {};
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
  annotate(schema.meta, { transform: name });
  return schema;
}

/**
 * The JSON a node's own schema `fields` write: each property as its schema
 * reads it, and left out where that reads as absent.
 */
export type SchemaJSON<F extends SerializationSchemaFields> = {
  [K in keyof F as undefined extends SerializationSchemaValue<F[K]>
    ? never
    : K]: SerializationSchemaValue<F[K]>;
} & {
  [K in keyof F as undefined extends SerializationSchemaValue<F[K]>
    ? K
    : never]?: SerializationSchemaValue<F[K]>;
};

/** A flag read as `value || false` reads it: false for none, else as stored. */
export const falseOrStored = namedTransform(
  "falseOrStored",
  rawValue<boolean>(),
  (value) => value || false,
);

/** A value read as `value || ""` reads it: empty for none, else as stored. */
export function emptyOrStored<T extends string>() {
  return namedTransform(
    "emptyOrStored",
    rawValue<T | "">(),
    (value) => value || "",
  );
}

/** The schema `klass` reads `key` by, as Lexical composes it. */
export function composedField(
  klass: Klass<LexicalNode>,
  key: string,
): AnySerializationSchema {
  const field = getComposedSchemaFields(klass)[key];
  if (!field) throw new Error(`${klass.name} no longer declares its ${key}`);
  return field;
}

/**
 * Lexical's `rawValue`, but reading absence as `defaultValue`, and null too
 * where `nullAsAbsent`: what a node read with a default parameter, or `??`.
 */
export function rawValueOr<T>(
  defaultValue: T,
  { nullAsAbsent = false } = {},
): SerializationSchema<T, never, unknown> {
  const raw = storedValue<T>();
  const read = (value: unknown): T =>
    value === undefined || (nullAsAbsent && value === null)
      ? defaultValue
      : raw(value);
  if (nullAsAbsent) annotate(raw.meta, { nullAsAbsent: true });
  return Object.assign(read, { ...raw, defaultValue });
}

/**
 * `raw`, described as `shape`: data a node keeps exactly as it was stored,
 * which other implementations read as `shape` wherever it reads back as
 * itself.
 */
export function shapedAs<T>(
  shape: AnySerializationSchema,
  raw: SerializationSchema<T, never, unknown>,
): SerializationSchema<T, never, unknown> {
  annotate(raw.meta, { shape });
  return raw;
}

/**
 * `raw`, which the node reads as `checked` where it holds NodeState and as
 * stored otherwise.
 */
export function checkedWithState<T>(
  checked: AnySerializationSchema,
  raw: SerializationSchema<T, never, unknown>,
): SerializationSchema<T, never, unknown> {
  annotate(raw.meta, { checkedWithState: checked });
  return raw;
}

/**
 * `schema`, for a property the node writes as a new node holds it and never
 * reads: whatever was stored, it writes `schema`'s default.
 */
export function writtenOnly<S extends AnySerializationSchema>(schema: S): S {
  annotate(schema.meta, { writtenOnly: true });
  return schema;
}

/**
 * `schema` typed as the node holds what it reads: as it was stored, absent
 * included, the way the nodes read their JSON before they had schemas.
 */
export function asStored<T, In>(
  schema: SerializationSchema<T | undefined, never, In>,
): SerializationSchema<T, never, In> {
  return schema as SerializationSchema<T, never, In>;
}

/** Lexical's `rawValue`, typed as {@link asStored} describes. */
export function storedValue<T>(): SerializationSchema<T, never, unknown> {
  return asStored(rawValue<T>());
}

type EditorStateJSON = SerializedEditor["editorState"];

/** The root of an editor with nothing in it, as it's written. */
export const EMPTY_ROOT: SerializedRootNode = {
  children: [],
  direction: null,
  format: "",
  indent: 0,
  type: "root",
  version: 1,
};

/** What an editor with nothing in it writes. */
export const EMPTY_EDITOR_STATE: EditorStateJSON = { root: EMPTY_ROOT };

/** Whether `value` is an editor state with something in its root. */
export function holdsNodes(value: unknown): value is SerializedEditorState {
  if (typeof value !== "object" || value === null || !("root" in value)) {
    return false;
  }
  const { root } = value;
  return (
    typeof root === "object" &&
    root !== null &&
    "children" in root &&
    Array.isArray(root.children) &&
    root.children.length > 0
  );
}

/** `text` parsed, as `parseEditorState` parses a state stored as JSON text. */
function parsedOrNothing(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `schema`'s value is an editor state the node reads into `makeEditor`'s. */
export function readInto<S extends AnySerializationSchema>(
  makeEditor: () => LexicalEditor,
  schema: S,
): S {
  annotate(schema.meta, { nestedEditor: makeEditor });
  return schema;
}

/**
 * A nested editor's JSON, as `LexicalEditor.toJSON` writes it. A node writes
 * the editor it holds whatever it read, so JSON that holds nothing reads as
 * the empty editor it will write.
 */
export function nestedEditorValue(makeEditor: () => LexicalEditor) {
  return objectValue({
    editorState: readInto(
      makeEditor,
      namedTransform(
        "nestedEditorState",
        rawValueOr<unknown>(EMPTY_EDITOR_STATE),
        (stored): EditorStateJSON => {
          const state =
            typeof stored === "string" ? parsedOrNothing(stored) : stored;
          return holdsNodes(state) ? state : EMPTY_EDITOR_STATE;
        },
      ),
    ),
  });
}

export type NestedEditorJSON = SerializationSchemaValue<
  ReturnType<typeof nestedEditorValue>
>;

/**
 * Reads a nested editor's JSON into `editor`. JSON that holds nothing, or
 * that its editor can't read, leaves the editor as it was made: a caption
 * that can't be read shouldn't keep the document it's in from loading.
 */
export function setNestedEditorJSON(
  editor: LexicalEditor,
  { editorState }: NestedEditorJSON,
): void {
  let state: EditorState;
  try {
    state = editor.parseEditorState(editorState);
  } catch {
    return;
  }
  if (!state.isEmpty()) editor.setEditorState(state);
}
