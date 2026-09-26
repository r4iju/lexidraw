import {
  booleanValue,
  type EditorConfig,
  enumValue,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  numberValue,
  objectValue,
  type Spread,
  stringValue,
  withField,
} from "lexical";
import { type SchemaJSON, shapedAs, storedValue } from "../schema-values.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";
import { MarkerNode, type SerializedMarkerNode } from "./MarkerNode.js";

export type Comment = {
  author: string;
  content: string;
  deleted: boolean;
  id: string;
  timeStamp: number;
  type: "comment";
};

export const commentShape = objectValue({
  author: stringValue(),
  content: stringValue(),
  deleted: booleanValue(),
  id: stringValue(),
  timeStamp: numberValue(),
  type: enumValue(["comment"]),
});

/** A comment with nothing in it, which a marker made from nothing holds. */
export const EMPTY_COMMENT: Comment = {
  author: "",
  content: "",
  deleted: false,
  id: "",
  timeStamp: 0,
  type: "comment",
};

const { fields: commentFields, json: commentJSON } = storedFields({
  type: written,
  version: written,
  comment: withField(shapedAs(commentShape, storedValue<Comment>()), {
    field: "__comment",
  }),
  format: written,
  indent: written,
  direction: written,
  children: written,
});

export type SerializedCommentNode = Spread<
  SchemaJSON<typeof commentJSON>,
  SerializedMarkerNode
>;

const commentSchema = nodeSchema<CommentNode>()(commentFields);

/**
 * Serialization half of the comment marker; see ImageNode for the split.
 */
export class CommentNode extends MarkerNode {
  declare static importJSON: ImportJSON<CommentNode>;
  __comment: Comment;

  $config() {
    return this.config("comment", { extends: MarkerNode, json: commentSchema });
  }

  constructor(comment: Comment = EMPTY_COMMENT, key?: NodeKey) {
    super(key);
    this.__comment = comment;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = "LexicalCommentNode";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  static $isCommentNode = (
    node: LexicalNode | null | undefined,
  ): node is CommentNode => {
    return node?.getType?.() === "comment";
  };
}

withStoredJSON(CommentNode);
