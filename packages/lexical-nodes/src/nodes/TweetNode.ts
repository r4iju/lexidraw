import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import type {
  Klass,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  ElementFormatType,
  LexicalNode,
  NodeKey,
  Spread,
} from "lexical";
import { $create } from "lexical";
import { $importNodeState, figureDOM } from "../figure.js";

function $convertTweetElement(
  domNode: HTMLDivElement,
): DOMConversionOutput | null {
  const id = domNode.getAttribute("data-lexical-tweet-id");
  if (id) {
    const node = TweetNode.$createTweetNode(id);
    return { node };
  }
  return null;
}

export type SerializedTweetNode = Spread<
  {
    id: string;
  },
  SerializedDecoratorBlockNode
>;

export class TweetNode extends DecoratorBlockNode {
  __id: string;

  static getType(): string {
    return "tweet";
  }

  static clone(node: TweetNode): TweetNode {
    return new this(node.__id, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedTweetNode): TweetNode {
    const node = TweetNode.$createTweetNode(serializedNode.id);
    node.setFormat(serializedNode.format);
    return $importNodeState(node, serializedNode);
  }

  exportJSON(): SerializedTweetNode {
    return {
      ...super.exportJSON(),
      id: this.getId(),
      type: "tweet",
      version: 1,
    };
  }

  static importDOM(): DOMConversionMap<HTMLDivElement> | null {
    return {
      div: (domNode: HTMLDivElement) => {
        if (!domNode.hasAttribute("data-lexical-tweet-id")) {
          return null;
        }
        return {
          conversion: $convertTweetElement,
          priority: 2,
        };
      },
    };
  }

  createDOM(): HTMLElement {
    const element = super.createDOM();
    figureDOM(this, element);
    return element;
  }

  // The base class declares no parameters, though Lexical passes them.
  updateDOM(_prevNode?: TweetNode, dom?: HTMLElement): false {
    if (dom) figureDOM(this, dom);
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.setAttribute("data-lexical-tweet-id", this.__id);
    const text = document.createTextNode(this.getTextContent());
    element.append(text);
    return { element };
  }

  constructor(id = "", format?: ElementFormatType, key?: NodeKey) {
    super(format, key);
    this.__id = id;
  }

  getId(): string {
    return this.__id;
  }

  getTextContent(
    _includeInert?: boolean | undefined,
    _includeDirectionless?: false | undefined,
  ): string {
    return `https://x.com/i/web/status/${this.__id}`;
  }

  static $createTweetNode<T extends TweetNode>(
    this: Klass<T>,
    tweetID: string,
  ): T {
    const node = $create(this);
    node.__id = tweetID;
    return node;
  }

  static $isTweetNode<T extends TweetNode>(
    this: Klass<T>,

    node: TweetNode | LexicalNode | null | undefined,
  ): node is T {
    return node instanceof TweetNode;
  }
}
