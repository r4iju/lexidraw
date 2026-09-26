/**
 * The published schemas — the OpenAPI document and the MCP tool inputs — are
 * read by generators and clients that predate JSON Schema 2020-12, and a
 * spelling only the newest dialect understands costs a tool or a whole
 * operation rather than one field.
 *
 * One such spelling cannot be avoided at the source: zod collapses a union of
 * a primitive and null into `type: ["string", "null"]`, whichever way it is
 * written, and a reader that treats `type` as a string sees a plain string and
 * refuses every null the field is allowed to carry. So the rewrite happens
 * where the schema is published.
 *
 * The other, a fixed-length tuple's `items: false`, is avoided at the source
 * instead — see `Point` in `server/drawings/skeleton-schema.ts` — because the
 * portable spelling there says exactly as much.
 *
 * One reader wants the opposite: swift-openapi-generator, which generates the
 * iOS app's client, reads a nullable only as a `type` list. An `anyOf` with a
 * `{ type: "null" }` member, the portable spelling and zod's own for enums and
 * dates, makes it skip the whole property (apple/swift-openapi-generator#286),
 * and a response object that forbids additional properties then refuses every
 * answer carrying one.
 */
export type SchemaDialect =
  /** Every list-valued `type` spelled as an `anyOf` over its members. */
  | "portable"
  /** Every nullable spelled as a `type` list, for swift-openapi-generator. */
  | "type-list-nullables";

export const SCHEMA_DIALECTS: readonly SchemaDialect[] = [
  "portable",
  "type-list-nullables",
];

/** `schema` spelled in `dialect`. */
export function inDialect<T>(schema: T, dialect: SchemaDialect): T {
  const node = dialect === "portable" ? anyOfForTypeList : typeListForNullable;
  // Only schema spellings change, never the shape the caller's type describes.
  return rewrite(schema, "$", node) as T;
}

/**
 * The keywords whose value is data rather than a schema. A `default` or an
 * `example` may legitimately be an object carrying a `type` key with a list
 * under it — a drawing element, say — and rewriting that would change the
 * document's data, not its constraints, so these are copied through untouched.
 */
const DATA_KEYWORDS: ReadonlySet<string> = new Set([
  "const",
  "default",
  "enum",
  "example",
  "examples",
]);

type SchemaNode = Record<string, unknown>;

function isNode(value: unknown): value is SchemaNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rewrite(
  value: unknown,
  path: string,
  node: (schema: SchemaNode, path: string) => SchemaNode,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => rewrite(item, `${path}[${index}]`, node));
  }
  if (!isNode(value)) return value;
  const out: SchemaNode = {};
  for (const [key, child] of Object.entries(node(value, path))) {
    out[key] = DATA_KEYWORDS.has(key)
      ? child
      : rewrite(child, `${path}.${key}`, node);
  }
  return out;
}

/**
 * The sibling keywords stay where they are: `format` applies to strings and
 * `items` to arrays, and every dialect ignores them on the values they do not
 * describe, so the constraint is unchanged.
 */
function anyOfForTypeList(schema: SchemaNode): SchemaNode {
  if (!Array.isArray(schema.type)) return schema;
  const union = schema.type.map((member) => ({ type: member }));
  // A node carrying both a list-valued `type` and an `anyOf` means both at
  // once — no node does today — so writing the type union over `anyOf` would
  // quietly drop half the constraint. `allOf` is the spelling that keeps them
  // both, and every dialect reads it.
  const conflicts = "anyOf" in schema;
  const out: SchemaNode = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== "type") out[key] = value;
    else if (!conflicts) out.anyOf = union;
  }
  if (conflicts) {
    const allOf = Array.isArray(schema.allOf) ? schema.allOf : [];
    out.allOf = [...allOf, { anyOf: union }];
  }
  return out;
}

function isNull(member: unknown): boolean {
  return (
    isNode(member) && Object.keys(member).length === 1 && member.type === "null"
  );
}

/**
 * A union the list cannot say is refused rather than passed through, since
 * passing it through is what gets it skipped.
 */
function typeListForNullable(schema: SchemaNode, path: string): SchemaNode {
  const { anyOf, ...siblings } = schema;
  if (!Array.isArray(anyOf) || !anyOf.some(isNull)) return schema;
  const members = anyOf.filter((member) => !isNull(member));
  const [member] = members;
  if (
    members.length !== 1 ||
    !isNode(member) ||
    typeof member.type !== "string"
  ) {
    throw new Error(`${path}: a nullable of ${JSON.stringify(members)}`);
  }
  const clash = Object.keys(member).find((key) => key in siblings);
  if (clash) throw new Error(`${path}: \`${clash}\` inside and beside anyOf`);
  const merged: SchemaNode = {
    ...siblings,
    ...member,
    type: [member.type, "null"],
  };
  if (Array.isArray(member.enum)) merged.enum = [...member.enum, null];
  return typeListForNullable(merged, path);
}
