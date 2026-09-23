import { z } from "zod";

import { AccessLevel, EntityType } from "@packages/types";

/** A date reaches a REST client as an ISO string; tRPC clients get a Date. */
export const isoDate = z.date().meta({ format: "date-time" });

/**
 * `z.coerce.boolean()` reads the string "false" as true, which a query
 * parameter cannot afford, so both spellings are spelled out.
 */
export const queryBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true");

/**
 * A repeated query parameter arrives as a bare string when only one value is
 * sent, so REST callers may also comma-separate. tRPC callers keep passing
 * arrays. `what` names the values in the document, since the comma branch is
 * otherwise an unconstrained string.
 */
export const stringList = <T extends z.ZodType<string, string>>(
  item: T,
  what: string,
) => {
  const options = item instanceof z.ZodEnum ? (item.options as string[]) : null;
  const alternatives = options?.join("|");
  const csv = (
    alternatives
      ? z.string().regex(new RegExp(`^(${alternatives})(,(${alternatives}))*$`))
      : z.string()
  ).describe(
    options
      ? `${what}, comma-separated; each one of ${options.join(", ")}.`
      : `${what}, comma-separated.`,
  );
  return z.union([
    z.array(item),
    csv
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(item)),
  ]);
};

/**
 * The columns behind these hold plain text, so the parser is what enforces the
 * enum: a row carrying anything else fails loudly instead of being described
 * as something it is not.
 */
export const entityTypeOut = z.string().pipe(z.enum(EntityType));
export const accessLevelOut = z.string().pipe(z.enum(AccessLevel));
