import { z } from "zod";

export type ToolDef = {
  name: string;
  parameters: Record<string, unknown>;
  description?: string;
};

export function buildToolDef(
  name: string,
  schema: z.ZodType | undefined,
  description?: string,
): ToolDef | null {
  if (!schema) return null;
  // Providers require a self-contained object schema; zod inlines refs unless
  // the schema is recursive, and `unrepresentable: "any"` keeps custom types
  // from throwing instead of degrading to `{}`.
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  // Ensure the root is an object schema as required by function-calling
  if (json.type !== "object") {
    return null;
  }
  return {
    name,
    parameters: json as Record<string, unknown>,
    description,
  };
}
