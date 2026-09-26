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
import { MarkerNode, type SerializedMarkerNode } from "./MarkerNode.js";

export type Comment = {
  author: string;
  content: string;
  deleted: boolean;
  id: string;
  timeStamp: number;
  type: "comment";
};

export type SerializedCommentNode = Spread<
  { type: "comment"; version: 1; comment: Comment },
  SerializedMarkerNode
>;

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

const commentFields = {
  comment: withField(shapedAs(commentShape, storedValue<Comment>()), {
    field: "__comment",
  }),
};

/** @internal What {@link commentFields} write, which {@link SerializedCommentNode} is checked against. */
export type CommentFieldsJSON = SchemaJSON<typeof commentFields>;

const commentSchema = nodeSchema<CommentNode>()(commentFields);

/**
 * Serialization half of the comment marker; see ImageNode for the split.
 */
export class CommentNode extends MarkerNode {
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
