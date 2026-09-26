import {
  $applyNodeReplacement,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type SerializedTextNode,
  type Spread,
  stringValue,
  TextNode,
  withField,
} from "lexical";

export type SerializedEmojiNode = Spread<
  {
    className: string;
  },
  SerializedTextNode
>;

const emojiSchema = nodeSchema<EmojiNode>()({
  className: withField(stringValue(), { field: "__className" }),
});

export class EmojiNode extends TextNode {
  __className: string;

  $config() {
    return this.config("emoji", { extends: TextNode, json: emojiSchema });
  }

  constructor(className = "", text = "", key?: NodeKey) {
    super(text, key);
    this.__className = className;
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
