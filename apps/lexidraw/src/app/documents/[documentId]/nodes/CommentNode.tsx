import type { EditorConfig, LexicalNode, NodeKey } from "lexical";
import { DecoratorNode } from "lexical";
import * as React from "react";
import type { Comment, Thread } from "../commenting";

export class CommentNode extends DecoratorNode<React.JSX.Element> {
  __comment: Comment;

  constructor(comment: Comment, key?: NodeKey) {
    super(key); // pass key up to the parent
    this.__comment = comment;
  }

  static getType() {
    return "comment" as const;
  }

  static clone(node: CommentNode) {
    return new CommentNode(node.__comment, node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    // Minimal DOM — or you can skip this if you really
    // don't need a real DOM element. Usually for a DecoratorNode,
    // you still want an empty container or span.
    const div = document.createElement("div");
    // Possibly add some styling if you want the DOM to hold a placeholder
    // while React is hydrated. Or you can do nothing:
    div.className = "sr-only";
    return div;
  }

  updateDOM(): false {
    // We do not rely on the DOM updates here, so returning false
    // means "don't reapply createDOM() if the node changes."
    return false;
  }

  /**
   * This is the critical method for DecoratorNodes in Lexical >= 0.22
   * that must be implemented to avoid "base method not extended" errors.
   */
  decorate(): React.JSX.Element {
    return <span className="sr-only">{this.__comment.content}</span>;
  }

  exportJSON() {
    return {
      type: CommentNode.getType(),
      comment: this.__comment,
      version: 1,
    };
  }

  static importJSON(serializedNode: any): CommentNode {
    const { comment } = serializedNode;
    return new CommentNode(comment);
  }
}

export function $isCommentNode(node: LexicalNode | null): node is CommentNode {
  return node?.getType() === "comment";
}

export class ThreadNode extends DecoratorNode<React.JSX.Element> {
  __thread: Thread;

  constructor(thread: Thread, key?: NodeKey) {
    super(key);
    this.__thread = thread;
  }

  static getType() {
    return "thread" as const;
  }

  static clone(node: ThreadNode) {
    return new ThreadNode(node.__thread, node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = "sr-only";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.JSX.Element {
    return <span className="sr-only">{this.__thread.quote}</span>;
  }

  exportJSON() {
    return {
      type: ThreadNode.getType(),
      thread: this.__thread,
      version: 1,
    };
  }

  static importJSON(serializedNode: any): ThreadNode {
    const { thread } = serializedNode;
    return new ThreadNode(thread);
  }
}

export function $isThreadNode(node: LexicalNode | null): node is ThreadNode {
  return node?.getType() === "thread";
}
