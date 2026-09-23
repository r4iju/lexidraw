/**
 * Every spot in a published JSON Schema that a client reading only draft-07,
 * or one reading 2020-12 strictly, would refuse or silently misread:
 *
 * - a boolean standing in for a schema, which is how zod writes a
 *   fixed-length tuple (`items: false`) and what makes a strict MCP client
 *   drop the whole tool;
 * - a `type` given as a list, which is how zod writes a nullable and which a
 *   reader taking `type` for a string turns into a field that refuses every
 *   null it is allowed to carry.
 *
 * `additionalProperties` is the one keyword every dialect has always let be a
 * boolean, and `required` is OpenAPI's own boolean on a parameter, so neither
 * is reported.
 *
 * Shared by the OpenAPI document's test and the MCP tool schemas' test: the
 * two publish the same router through different generators, and the rule they
 * both have to keep is this one.
 */
export function unportable(node: unknown, path: string, into: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      unportable(item, `${path}[${index}]`, into);
    });
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (typeof value === "boolean") {
      if (key !== "additionalProperties" && key !== "required") {
        into.push(`${here} is ${value}, not a schema`);
      }
      continue;
    }
    if (key === "type" && Array.isArray(value)) {
      into.push(`${here} is a list: ${JSON.stringify(value)}`);
      continue;
    }
    unportable(value, here, into);
  }
}
