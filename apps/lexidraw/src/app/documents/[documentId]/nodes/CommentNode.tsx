import {
  DecoratorNode,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  SerializedLexicalNode,
} from "lexical";
import type { JSX } from "react";

import type { Comment } from "../commenting";

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

export class CommentNode extends DecoratorNode<JSX.Element> {
  __comment: Comment;
  __format: number;
  __indent: number;
  __direction: "ltr" | "rtl" | null;

  constructor(comment: Comment, key?: string) {
    super(key);
    this.__comment = comment;
    this.__format = 0;
    this.__indent = 0;
    this.__direction = null;
  }

  static getType(): string {
    return "comment";
  }

  static clone(node: CommentNode): CommentNode {
    return new CommentNode(node.__comment, node.__key);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = "LexicalCommentNode";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    // hidden since side panel does the heavy-lifting
    return <div className="hidden" />;
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
    const node = new CommentNode(serializedNode.comment);
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    return node;
  }
}

export function $isCommentNode(
  node: LexicalNode | null | undefined,
): node is CommentNode {
  return node?.getType?.() === "comment";
}
