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
 */

/**
 * `schema` with every list-valued `type` rewritten as an `anyOf` over the
 * members. The sibling keywords stay where they are: `format` applies to
 * strings and `items` to arrays, and every dialect ignores them on the values
 * they do not describe, so the constraint is unchanged.
 */
export function portableJsonSchema<T>(schema: T): T {
  return rewrite(schema) as T;
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

function rewrite(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewrite);
  if (node === null || typeof node !== "object") return node;
  // A node carrying both a list-valued `type` and an `anyOf` means both at
  // once — no node does today — so writing the type union over `anyOf` would
  // quietly drop half the constraint. `allOf` is the spelling that keeps them
  // both, and every dialect reads it.
  const conflicts = "anyOf" in node;
  const out: Record<string, unknown> = {};
  const alsoRequired: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" && Array.isArray(value)) {
      const union = value.map((member) => ({ type: member }));
      if (conflicts) alsoRequired.push({ anyOf: union });
      else out.anyOf = union;
      continue;
    }
    out[key] = DATA_KEYWORDS.has(key) ? value : rewrite(value);
  }
  if (alsoRequired.length > 0) {
    const existing = Array.isArray(out.allOf) ? out.allOf : [];
    out.allOf = [...existing, ...alsoRequired];
  }
  return out;
}
