import { z } from "zod";

function unwrapEffects(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current.innerType();
  }
  return current;
}

function getDefaultValue(schema: z.ZodTypeAny): unknown {
  const unwrapped = unwrapEffects(schema);

  if (unwrapped instanceof z.ZodDefault) {
    // In zod, defaultValue is a thunk that returns the default
    const defaultValue = (
      (unwrapped as z.ZodDefault<z.ZodTypeAny>)._def
        .defaultValue as () => unknown
    )();
    return defaultValue;
  }

  if (unwrapped instanceof z.ZodArray) return [];
  if (unwrapped instanceof z.ZodString) return "";
  if (unwrapped instanceof z.ZodBoolean) return false;
  if (unwrapped instanceof z.ZodNumber) return 0;

  if (unwrapped instanceof z.ZodObject) {
    const shape = (unwrapped as z.AnyZodObject).shape;
    return Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [
        key,
        getDefaultValue(value as z.ZodTypeAny),
      ]),
    );
  }

  const defUnknown: unknown = (unwrapped as z.ZodTypeAny)._def as unknown;
  if (hasInnerType(defUnknown)) {
    return getDefaultValue(defUnknown.innerType);
  }

  return undefined;
}

function hasInnerType(value: unknown): value is { innerType: z.ZodTypeAny } {
  return (
    typeof value === "object" &&
    value !== null &&
    "innerType" in (value as object)
  );
}

export function getDefaults(
  schema: z.AnyZodObject | z.ZodEffects<z.AnyZodObject>,
): Record<string, unknown> {
  const inner = unwrapEffects(schema);
  if (!(inner instanceof z.ZodObject)) return {};

  const shape = (inner as z.AnyZodObject).shape;
  return Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [
      key,
      getDefaultValue(value as z.ZodTypeAny),
    ]),
  );
}
