import {
  arrayValue,
  booleanValue,
  type EditorConfig,
  enumValue,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  optional,
  type SerializedLexicalNode,
  stringValue,
  withField,
} from "lexical";
import { openObjectValue } from "../schema-values.js";
import { type Comment, commentValue } from "./CommentNode.js";
import { MarkerNode, type SerializedMarkerFields } from "./MarkerNode.js";

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
  thread: Thread;
} & SerializedMarkerFields &
  SerializedLexicalNode;

const threadValue = openObjectValue({
  comments: arrayValue(commentValue),
  id: stringValue(),
  quote: stringValue(),
  type: enumValue(["thread"]),
  resolved: optional(booleanValue()),
});

const threadSchema = nodeSchema<ThreadNode>()({
  thread: withField(threadValue, { field: "__thread" }),
});

/**
 * Serialization half of the comment thread marker; see ImageNode for the split.
 */
export class ThreadNode extends MarkerNode {
  __thread: Thread;

  constructor(thread: Thread = threadValue.defaultValue, key?: NodeKey) {
    super(key);
    this.__thread = thread;
  }

  $config() {
    return this.config("thread", { extends: MarkerNode, json: threadSchema });
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = "LexicalThreadNode";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  getThread(): Thread {
    return this.getLatest().__thread;
  }

  setThread(thread: Thread): this {
    const writable = this.getWritable();
    writable.__thread = thread;
    return writable;
  }

  static $isThreadNode = (
    node: LexicalNode | null | undefined,
  ): node is ThreadNode => {
    return node?.getType?.() === "thread";
  };
}
