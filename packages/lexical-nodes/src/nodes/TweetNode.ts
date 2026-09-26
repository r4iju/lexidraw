import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import {
  $create,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type ElementFormatType,
  type Klass,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  nodeSchema,
  type Spread,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { figureDOM, figureState } from "../figure.js";
import { inStoredOrder } from "../stored-order.js";
import { storedBlockFields, withStoredBlockFormat } from "./stored-block.js";

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
  { id: string },
  SerializedDecoratorBlockNode
>;

const tweetFields = {
  ...storedBlockFields,
  id: withField(storedValue<string>(), { field: "__id" }),
};

/** @internal What {@link tweetFields} write, which {@link SerializedTweetNode} is checked against. */
export type TweetFieldsJSON = SchemaJSON<typeof tweetFields>;

const tweetSchema = nodeSchema<TweetNode>()(tweetFields);

export class TweetNode extends DecoratorBlockNode {
  __id: string;

  $config() {
    return this.config("tweet", {
      extends: DecoratorBlockNode,
      json: tweetSchema,
      stateConfigs: [figureState],
    });
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

  updateFromJSON(json: LexicalParseJSON<SerializedDecoratorBlockNode>): this {
    return super.updateFromJSON(withStoredBlockFormat(json));
  }

  exportJSON(): SerializedDecoratorBlockNode {
    return inStoredOrder(super.exportJSON(), ["id"]);
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
