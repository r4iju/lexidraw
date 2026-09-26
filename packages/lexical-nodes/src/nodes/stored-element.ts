import { enumValue, numberValue, stringValue, withAccessors } from "lexical";
import { writtenOnly } from "../schema-values.js";
import { storedFields, written } from "../stored-fields.js";

/** Where an element writes its children and what ElementNode declares. */
export const writtenElementFields = {
  children: written,
  direction: written,
  format: written,
  indent: written,
  textFormat: written,
  textStyle: written,
} as const;

/**
 * ElementNode's properties for the elements that write them but never read
 * them back: a collapsible section's parts and a layout's items are written
 * as the node holds them, and read as a new node has them. Each is written as
 * ElementNode writes it; none has a setter.
 * @internal
 */
export const unreadElementFields = {
  direction: withAccessors(writtenOnly(enumValue([null, "ltr", "rtl"])), {
    getter: { field: "__dir" },
    setter: null,
  }),
  format: withAccessors(
    writtenOnly(
      enumValue(["", "left", "start", "center", "right", "end", "justify"]),
    ),
    { getter: "getFormatType", setter: null },
  ),
  indent: withAccessors(writtenOnly(numberValue(0)), {
    getter: { field: "__indent" },
    setter: null,
  }),
  textFormat: withAccessors(writtenOnly(numberValue()), {
    getter: {
      field: "__textFormat",
      method: "getSerializedTextFormat",
      when: "shouldSerializeTextStyles",
    },
    setter: null,
  }),
  textStyle: withAccessors(writtenOnly(stringValue()), {
    getter: {
      field: "__textStyle",
      method: "getSerializedTextStyle",
      when: "shouldSerializeTextStyles",
    },
    setter: null,
  }),
};

/**
 * The fields of an element that writes {@link unreadElementFields} and
 * nothing of its own.
 * @internal
 */
export const { fields: unreadElementOnlyFields } = storedFields({
  children: written,
  ...unreadElementFields,
  type: written,
  version: written,
});
