import {
  aliasedValue,
  enumValue,
  rawValue,
  type SerializationSchema,
  TextNode,
  withAccessors,
  withField,
} from "lexical";
import {
  asStored,
  composedField,
  namedTransform,
  rawValueOr,
  storedValue,
} from "../schema-values.js";

/** The names TextNode reads `key` by, as its own schema declares them. */
function aliasesOf(key: "detail" | "format") {
  const { meta } = composedField(TextNode, key);
  if (meta.kind !== "aliased") {
    throw new Error(`TextNode's ${key} is no longer read by name`);
  }
  return Object.fromEntries(
    Object.entries(meta.aliases).filter(
      (alias): alias is [string, number] => typeof alias[1] === "number",
    ),
  );
}

/**
 * A string that isn't one of the names read as absent, and anything else as
 * it is: what TextNode's setters store for a name they don't know.
 */
const unnamedStringAbsent = asStored(
  namedTransform("stringAbsent", rawValue<number | string>(), (value) =>
    typeof value === "string" ? undefined : value,
  ),
);

/**
 * TextNode's properties as the text nodes here read them before they had
 * schemas: through TextNode's setters, which look a name up and store any
 * other value as it is, where TextNode's schema reads a number.
 * @internal
 */
export function storedTextFields(
  text: SerializationSchema<string, never, unknown>,
) {
  return {
    detail: withField(aliasedValue(unnamedStringAbsent, aliasesOf("detail")), {
      field: "__detail",
    }),
    format: withField(aliasedValue(unnamedStringAbsent, aliasesOf("format")), {
      field: "__format",
    }),
    mode: withAccessors(
      asStored(enumValue([undefined, "normal", "token", "segmented"])),
      { getter: "getMode", setter: "setMode" },
    ),
    style: withField(storedValue<string>(), { field: "__style" }),
    text: withAccessors(text, {
      getter: "getTextContent",
      setter: "setTextContent",
    }),
  };
}

/** The text of a node made with no text, which is empty. */
export const textOrEmpty = rawValueOr("");
