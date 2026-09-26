import {
  DecoratorNode,
  enumValue,
  nodeSchema,
  type SerializedLexicalNode,
  type Spread,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { storedFields } from "../stored-fields.js";

/**
 * The element fields a comment or thread marker once copied, stored as they
 * were read: `direction` was never set, so it is always null.
 */
const { fields: markerFields, json: markerJSON } = storedFields({
  format: withField(storedValue<number>(), { field: "__format" }),
  indent: withField(storedValue<number>(), { field: "__indent" }),
  direction: withField(enumValue([null]), { field: "__direction" }),
});

/**
 * What a comment or thread marker writes beside its own data, and an empty
 * list of children, which it has never held.
 */
export type SerializedMarkerNode = Spread<
  SchemaJSON<typeof markerJSON> & { children: [] },
  SerializedLexicalNode
>;

const markerSchema = nodeSchema<MarkerNode>()(markerFields);

/** What the comment and thread markers write beside their own data. */
export class MarkerNode extends DecoratorNode<unknown> {
  __format = 0;
  __indent = 0;
  __direction = null;

  $config() {
    return this.config(Symbol.for("lexidraw.MarkerNode"), {
      extends: DecoratorNode,
      json: markerSchema,
    });
  }
}
