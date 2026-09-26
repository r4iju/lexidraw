import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import {
  type ElementFormatType,
  type LexicalParseJSON,
  withField,
} from "lexical";
import {
  checkedWithState,
  composedField,
  storedValue,
} from "../schema-values.js";

const checkedFormat = composedField(DecoratorBlockNode, "format");

/**
 * DecoratorBlockNode's `format` as the embeds read it before they had
 * schemas: as it was stored, unless the node holds NodeState. They read that
 * through DecoratorBlockNode's schema, which reads the format again, so
 * {@link withStoredBlockFormat} checks it there as the schema does.
 * @internal
 */
export const storedBlockFields = {
  format: withField(
    checkedWithState(checkedFormat, storedValue<ElementFormatType>()),
    { field: "__format" },
  ),
};

/** `json` with its format read as {@link storedBlockFields} describes. */
export function withStoredBlockFormat<
  T extends LexicalParseJSON<SerializedDecoratorBlockNode>,
>(json: T): T {
  return json.$ ? { ...json, format: checkedFormat(json.format) } : json;
}
