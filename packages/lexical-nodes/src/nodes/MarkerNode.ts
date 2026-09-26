import {
  DecoratorNode,
  enumValue,
  type LexicalParseJSON,
  nodeSchema,
  type SerializedLexicalNode,
  type Spread,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { inStoredOrder, withoutNodeState } from "../stored-order.js";

/** What a comment or thread marker writes before its own data. */
export type SerializedMarkerNode = Spread<
  { format: number; indent: number; direction: null; children: [] },
  SerializedLexicalNode
>;

/**
 * The element fields a comment or thread marker once copied, stored as they
 * were read: `direction` was never set, so it is always null.
 */
const markerFields = {
  format: withField(storedValue<number>(), { field: "__format" }),
  indent: withField(storedValue<number>(), { field: "__indent" }),
  direction: withField(enumValue([null]), { field: "__direction" }),
};

/** @internal What {@link markerFields} write, which {@link SerializedMarkerNode} is checked against. */
export type MarkerFieldsJSON = SchemaJSON<typeof markerFields>;

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

  /**
   * `type` and `version` first, then everything else, and an empty list of
   * children, which a marker has never held but has always written.
   */
  exportJSON(): SerializedLexicalNode {
    const json = { ...super.exportJSON(), children: [] };
    const rest = Object.keys(json).filter(
      (key) => key !== "type" && key !== "version",
    );
    return inStoredOrder(json, rest);
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }
}
