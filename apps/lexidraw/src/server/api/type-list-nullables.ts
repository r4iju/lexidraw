/**
 * The published document with every nullable spelled as a `type` list, for
 * swift-openapi-generator, which generates the iOS app's client. It reads a
 * nullable only that way: an `anyOf` with a `{ type: "null" }` member, the
 * portable spelling and zod's own for enums and dates, makes it skip the whole
 * property (apple/swift-openapi-generator#286), and a response object that
 * forbids additional properties then refuses every answer carrying one.
 *
 * A union the list cannot say is refused rather than passed through, since
 * passing it through is what gets it skipped.
 */
export function typeListNullables<T>(schema: T): T {
  return rewrite(schema, "$") as T;
}

const DATA_KEYWORDS: ReadonlySet<string> = new Set([
  "const",
  "default",
  "enum",
  "example",
  "examples",
]);

function isNull(node: unknown): boolean {
  return (
    node !== null &&
    typeof node === "object" &&
    Object.keys(node).length === 1 &&
    (node as { type?: unknown }).type === "null"
  );
}

function rewrite(node: unknown, path: string): unknown {
  if (Array.isArray(node)) {
    return node.map((item, index) => rewrite(item, `${path}[${index}]`));
  }
  if (node === null || typeof node !== "object") return node;

  const { anyOf, ...siblings } = node as Record<string, unknown>;
  if (Array.isArray(anyOf) && anyOf.some(isNull)) {
    const members = anyOf.filter((member) => !isNull(member));
    const member = members[0] as Record<string, unknown> | undefined;
    if (members.length !== 1 || typeof member?.type !== "string") {
      throw new Error(`${path}: a nullable of ${JSON.stringify(members)}`);
    }
    const clash = Object.keys(member).find((key) => key in siblings);
    if (clash) throw new Error(`${path}: \`${clash}\` inside and beside anyOf`);
    const merged: Record<string, unknown> = {
      ...siblings,
      ...member,
      type: [member.type, "null"],
    };
    if (Array.isArray(member.enum)) merged.enum = [...member.enum, null];
    return rewrite(merged, path);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = DATA_KEYWORDS.has(key)
      ? value
      : rewrite(value, `${path}.${key}`);
  }
  return out;
}
