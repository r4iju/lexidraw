import {
  DecoratorNode,
  enumValue,
  nodeSchema,
  numberValue,
  type SerializedLexicalNode,
  withAccessors,
  withField,
} from "lexical";

export type SerializedMarkerFields = {
  format: number;
  indent: number;
  direction: null;
  children: SerializedLexicalNode[];
};

type SerializedMarkerNode = SerializedLexicalNode & SerializedMarkerFields;

/**
 * The element fields a comment or thread marker once copied: `direction` was
 * never set, so it is always null.
 */
const markerSchema = nodeSchema<MarkerNode>()({
  format: withField(numberValue(), { field: "__format" }),
  indent: withField(numberValue(), { field: "__indent" }),
  direction: withAccessors(enumValue([null]), {
    getter: { field: "__direction" },
    setter: null,
  }),
});

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

  /** A marker holds no children, but has always written an empty list. */
  exportJSON(): SerializedMarkerNode {
    return { ...(super.exportJSON() as SerializedMarkerNode), children: [] };
  }
}
