import {
  booleanValue,
  type EditorConfig,
  enumValue,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  numberValue,
  type SerializedLexicalNode,
  stringValue,
  withField,
} from "lexical";
import { openObjectValue } from "../schema-values.js";
import { MarkerNode, type SerializedMarkerFields } from "./MarkerNode.js";

export type Comment = {
  author: string;
  content: string;
  deleted: boolean;
  id: string;
  timeStamp: number;
  type: "comment";
};

export type SerializedCommentNode = {
  type: "comment";
  version: 1;
  comment: Comment;
} & SerializedMarkerFields &
  SerializedLexicalNode;

export const commentValue = openObjectValue({
  author: stringValue(),
  content: stringValue(),
  deleted: booleanValue(),
  id: stringValue(),
  timeStamp: numberValue(),
  type: enumValue(["comment"]),
});

const commentSchema = nodeSchema<CommentNode>()({
  comment: withField(commentValue, { field: "__comment" }),
});

/**
 * Serialization half of the comment marker; see ImageNode for the split.
 */
export class CommentNode extends MarkerNode {
  __comment: Comment;

  $config() {
    return this.config("comment", { extends: MarkerNode, json: commentSchema });
  }

  constructor(comment: Comment = commentValue.defaultValue, key?: NodeKey) {
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
