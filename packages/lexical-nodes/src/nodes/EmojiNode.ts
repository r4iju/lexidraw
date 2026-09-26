import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  nodeSchema,
  type SerializedLexicalNode,
  type SerializedTextNode,
  type Spread,
  TextNode,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { inStoredOrder, withoutNodeState } from "../stored-order.js";
import { storedTextFields, textOrEmpty } from "./stored-text.js";

export type SerializedEmojiNode = Spread<
  { className: string },
  SerializedTextNode
>;

const emojiFields = {
  ...storedTextFields(textOrEmpty),
  className: withField(storedValue<string>(), { field: "__className" }),
};

/** @internal What {@link emojiFields} write, which {@link SerializedEmojiNode} is checked against. */
export type EmojiFieldsJSON = SchemaJSON<typeof emojiFields>;

const emojiSchema = nodeSchema<EmojiNode>()(emojiFields);

export class EmojiNode extends TextNode {
  __className: string;

  $config() {
    return this.config("emoji", { extends: TextNode, json: emojiSchema });
  }

  constructor(className = "", text = "", key?: NodeKey) {
    super(text, key);
    this.__className = className;
  }

  exportJSON(): SerializedTextNode {
    return inStoredOrder(super.exportJSON(), ["className"]);
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement("span");
    const inner = super.createDOM(config);
    dom.className = this.__className;
    inner.className = "emoji-inner";
    dom.appendChild(inner);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const inner = dom.firstChild;
    if (inner === null) {
      return true;
    }
    super.updateDOM(prevNode, inner as HTMLElement, config);
    return false;
  }

  getClassName(): string {
    const self = this.getLatest();
    return self.__className;
  }

  static $isEmojiNode(node: LexicalNode | null | undefined): node is EmojiNode {
    return node instanceof EmojiNode;
  }

  static $createEmojiNode(className: string, emojiText: string): EmojiNode {
    const node = new EmojiNode(className, emojiText).setMode("token");
    return $applyNodeReplacement(node);
  }
}
