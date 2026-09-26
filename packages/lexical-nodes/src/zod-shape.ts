import {
  arrayValue,
  booleanValue,
  enumValue,
  type InnerSerializationSchema,
  nullable,
  numberValue,
  objectValue,
  optional,
  rawValue,
  stringValue,
  unionValue,
} from "lexical";
import { z } from "zod";

/**
 * The Lexical schema a zod schema describes, for data a node keeps as stored
 * and states the shape of once, in zod. Anything zod doesn't pin down, such
 * as a `z.custom` value, is a raw one.
 */
export function shapeFromZod(
  schema: z.core.$ZodType,
): InnerSerializationSchema {
  if (schema instanceof z.ZodObject) {
    return objectValue(
      Object.fromEntries(
        Object.entries(schema.shape).map(([key, field]) => [
          key,
          shapeFromZod(field),
        ]),
      ),
    );
  }
  if (schema instanceof z.ZodOptional) {
    return optional(shapeFromZod(schema.unwrap()));
  }
  if (schema instanceof z.ZodNullable) {
    return nullable(shapeFromZod(schema.unwrap()));
  }
  if (schema instanceof z.ZodArray)
    return arrayValue(shapeFromZod(schema.element));
  if (schema instanceof z.ZodUnion) {
    return unionValue(schema.options.map(shapeFromZod), undefined);
  }
  if (schema instanceof z.ZodEnum) return enumOf(schema.options);
  if (schema instanceof z.ZodLiteral) return enumOf([...schema.values]);
  if (schema instanceof z.ZodString) return stringValue();
  if (schema instanceof z.ZodNumber) return numberValue();
  if (schema instanceof z.ZodBoolean) return booleanValue();
  if (
    schema instanceof z.ZodCustom ||
    schema instanceof z.ZodUnknown ||
    schema instanceof z.ZodAny
  ) {
    return rawValue();
  }
  throw new Error(`No shape for a zod ${schema._zod.def.type}`);
}

function enumOf(values: readonly unknown[]) {
  const [first, ...rest] = values;
  return enumValue([first, ...rest]);
}
