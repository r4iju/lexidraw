import { z } from "zod";

/**
 * Returns the default value for a given Zod schema. It does so by
 * parsing an empty object {} (or `undefined` for non-objects), letting
 * Zod's built-in `.default()` machinery populate the structure.
 *
 * NOTE: All non-optional leaf properties must have explicit `.default()`
 * values for this to succeed; otherwise the parse will throw.
 */
export function getDefaults<T extends z.ZodTypeAny>(schema: T): z.output<T> {
  if (schema instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    const shape = schema.shape;

    for (const key of Object.keys(shape)) {
      const propSchema = shape[key] as z.ZodTypeAny;
      const parsed = propSchema.safeParse(undefined);
      if (parsed.success) {
        out[key] = parsed.data;
      }
    }

    return out as z.output<T>;
  }

  // For non-object schemas attempt simple parse(undefined).
  const result = schema.safeParse(undefined);
  return (result.success ? result.data : undefined) as z.output<T>;
}
