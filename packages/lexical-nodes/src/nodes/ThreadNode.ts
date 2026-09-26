import {
  arrayValue,
  booleanValue,
  type EditorConfig,
  enumValue,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  objectValue,
  optional,
  type Spread,
  stringValue,
  withField,
} from "lexical";
import { type SchemaJSON, shapedAs, storedValue } from "../schema-values.js";
import { type Comment, commentShape } from "./CommentNode.js";
import { MarkerNode, type SerializedMarkerNode } from "./MarkerNode.js";

export type Thread = {
  comments: Comment[];
  id: string;
  quote: string;
  type: "thread";
  /** Settled: its range reads as plain text until the thread reopens. */
  resolved?: boolean;
};

export type SerializedThreadNode = Spread<
  { type: "thread"; version: 1; thread: Thread },
  SerializedMarkerNode
>;

/** A thread with nothing in it, which a marker made from nothing holds. */
const EMPTY_THREAD: Thread = {
  comments: [],
  id: "",
  quote: "",
  type: "thread",
};

const threadFields = {
  thread: withField(
    shapedAs(
      objectValue({
        comments: arrayValue(commentShape),
        id: stringValue(),
        quote: stringValue(),
        type: enumValue(["thread"]),
        resolved: optional(booleanValue()),
      }),
      storedValue<Thread>(),
    ),
    { field: "__thread" },
  ),
};

/** @internal What {@link threadFields} write, which {@link SerializedThreadNode} is checked against. */
export type ThreadFieldsJSON = SchemaJSON<typeof threadFields>;

const threadSchema = nodeSchema<ThreadNode>()(threadFields);

/**
 * Serialization half of the comment thread marker; see ImageNode for the split.
 */
export class ThreadNode extends MarkerNode {
  __thread: Thread;

  constructor(thread: Thread = EMPTY_THREAD, key?: NodeKey) {
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
