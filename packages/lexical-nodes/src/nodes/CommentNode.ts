import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";

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
  // original Lexical props
  format: number;
  indent: number;
  direction: "ltr" | "rtl" | null;
  children: SerializedLexicalNode[];
  // our custom data
  comment: Comment;
} & SerializedLexicalNode;

/**
 * Serialization half of the comment marker; see ImageNode for the split.
 */
export class CommentNode extends DecoratorNode<unknown> {
  __comment: Comment;
  __format: number;
  __indent: number;
  __direction: "ltr" | "rtl" | null;

  // Lexical constructs nodes with no arguments; every caller passes a comment.
  constructor(comment?: Comment, key?: NodeKey) {
    super(key);
    this.__comment = comment as Comment;
    this.__format = 0;
    this.__indent = 0;
    this.__direction = null;
  }

  static getType(): string {
    return "comment";
  }

  static clone(node: CommentNode): CommentNode {
    return new this(node.__comment, node.__key);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = "LexicalCommentNode";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  setFormat(format: number): void {
    this.__format = format;
  }

  setIndent(indent: number): void {
    this.__indent = indent;
  }

  exportJSON(): SerializedCommentNode {
    return {
      ...super.exportJSON(),
      type: "comment",
      comment: this.__comment,
      format: this.__format,
      indent: this.__indent,
      direction: this.__direction,
      children: [],
      version: 1,
    };
  }

  static importJSON(serializedNode: SerializedCommentNode): CommentNode {
    const node = new this(serializedNode.comment);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    return node;
  }

  static $isCommentNode = (
    node: LexicalNode | null | undefined,
  ): node is CommentNode => {
    return node?.getType?.() === "comment";
  };
}
