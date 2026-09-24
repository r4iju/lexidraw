import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import type { Comment } from "./CommentNode.js";

export type Thread = {
  comments: Comment[];
  id: string;
  quote: string;
  type: "thread";
  /** Settled: its range reads as plain text until the thread reopens. */
  resolved?: boolean;
};

export type SerializedThreadNode = {
  type: "thread";
  version: 1;
  // original Lexical props
  format: number;
  indent: number;
  direction: "ltr" | "rtl" | null;
  children: SerializedLexicalNode[]; // will hold children, possibly CommentNodes
  // our custom data
  thread: Thread;
} & SerializedLexicalNode;

/**
 * Serialization half of the comment thread marker; see ImageNode for the split.
 */
export class ThreadNode extends DecoratorNode<unknown> {
  // store the entire "thread" object here
  __thread: Thread;
  __format: number;
  __indent: number;
  __direction: "ltr" | "rtl" | null;

  // Lexical constructs nodes with no arguments; every caller passes a thread.
  constructor(thread?: Thread, key?: NodeKey) {
    super(key);
    this.__thread = thread as Thread;
    this.__format = 0;
    this.__indent = 0;
    this.__direction = null;
  }

  static getType(): string {
    return "thread";
  }

  static clone(node: ThreadNode): ThreadNode {
    return new this(node.__thread, node.__key);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = "LexicalThreadNode";
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

  getThread(): Thread {
    return this.getLatest().__thread;
  }

  setThread(thread: Thread): this {
    const writable = this.getWritable();
    writable.__thread = thread;
    return writable;
  }

  exportJSON(): SerializedThreadNode {
    return {
      ...super.exportJSON(),
      type: "thread",
      thread: this.__thread,
      version: 1,
      format: this.__format,
      indent: this.__indent,
      direction: this.__direction,
      children: [],
    };
  }

  static importJSON(serializedNode: SerializedThreadNode): ThreadNode {
    const node = new this(serializedNode.thread);
    // for an advanced use-case, you might re-insert child comment nodes
    // or do more advanced mapping. for now, we keep it simple.
    node.setFormat(serializedNode.format);
    node.setIndent(serializedNode.indent);
    return node;
  }

  static $isThreadNode = (
    node: LexicalNode | null | undefined,
  ): node is ThreadNode => {
    return node?.getType?.() === "thread";
  };
}
