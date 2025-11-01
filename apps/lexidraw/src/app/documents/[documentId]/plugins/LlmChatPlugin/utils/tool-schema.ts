import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type ToolDef = {
  name: string;
  parameters: Record<string, unknown>;
  description?: string;
};

export function buildToolDef(
  name: string,
  schema: ZodTypeAny | undefined,
  description?: string,
): ToolDef | null {
  if (!schema) return null;
  // Inline all refs so providers require no external definitions
  const json = zodToJsonSchema(schema, { $refStrategy: "none" });
  if (!json || typeof json !== "object") return null;
  const typeVal = (json as { type?: unknown }).type;
  // Ensure the root is an object schema as required by function-calling
  if (typeVal !== "object") {
    // If the converter did not return an object schema, reject to avoid invalid server errors.
    return null;
  }
  return {
    name,
    parameters: json as Record<string, unknown>,
    description,
  };
}
