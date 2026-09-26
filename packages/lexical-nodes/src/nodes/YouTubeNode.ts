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
  type NodeKey,
  nodeSchema,
  numberValue,
  type Spread,
  stringValue,
  withAccessors,
  withField,
} from "lexical";
import { figureDOM, figureState } from "../figure.js";
import { inheritForZero, zeroForInherit } from "../schema-values.js";

export type SerializedYouTubeNode = Spread<
  {
    videoID: string;
    width?: number;
    height?: number;
  },
  SerializedDecoratorBlockNode
>;

function $convertYoutubeElement(
  domNode: HTMLElement,
): null | DOMConversionOutput {
  const videoID = domNode.getAttribute("data-lexical-youtube");
  if (videoID) {
    const widthAttr = domNode.getAttribute("width");
    const heightAttr = domNode.getAttribute("height");
    const widthNum = widthAttr ? parseInt(widthAttr, 10) : undefined;
    const heightNum = heightAttr ? parseInt(heightAttr, 10) : undefined;
    const node = YouTubeNode.$createYouTubeNode(videoID, widthNum, heightNum);
    return { node };
  }
  return null;
}

const youTubeSchema = nodeSchema<YouTubeNode>()({
  videoID: withField(stringValue(), { field: "__id" }),
  width: withAccessors(numberValue(), {
    getter: "getWidthJSON",
    setter: "setWidthJSON",
  }),
  height: withAccessors(numberValue(), {
    getter: "getHeightJSON",
    setter: "setHeightJSON",
  }),
});

export class YouTubeNode extends DecoratorBlockNode {
  __id: string;
  __width: "inherit" | number;
  __height: "inherit" | number;

  $config() {
    return this.config("youtube", {
      extends: DecoratorBlockNode,
      json: youTubeSchema,
      stateConfigs: [figureState],
    });
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__id = prevNode.__id;
    this.__width = prevNode.__width;
    this.__height = prevNode.__height;
  }

  getWidthJSON(): number {
    return zeroForInherit(this.__width);
  }

  setWidthJSON(width: number): this {
    this.__width = inheritForZero(width);
    return this;
  }

  getHeightJSON(): number {
    return zeroForInherit(this.__height);
  }

  setHeightJSON(height: number): this {
    this.__height = inheritForZero(height);
    return this;
  }

  constructor(
    id = "",
    width?: "inherit" | number,
    height?: "inherit" | number,
    format?: ElementFormatType,
    key?: NodeKey,
  ) {
    super(format, key);
    this.__id = id;
    this.__width = width || "inherit";
    this.__height = height || "inherit";
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("iframe");
    element.setAttribute("data-lexical-youtube", this.__id);
    if (this.__width && this.__width !== "inherit") {
      element.setAttribute("width", this.__width.toString());
    }
    if (this.__height && this.__height !== "inherit") {
      element.setAttribute("height", this.__height.toString());
    }
    element.setAttribute(
      "src",
      `https://www.youtube-nocookie.com/embed/${this.__id}`,
    );
    element.setAttribute("frameborder", "0");
    element.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
    );
    element.setAttribute("allowfullscreen", "true");
    element.setAttribute("title", "YouTube video");
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      iframe: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-youtube")) {
          return null;
        }
        return {
          conversion: $convertYoutubeElement,
          priority: 1,
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
  updateDOM(_prevNode?: YouTubeNode, dom?: HTMLElement): false {
    if (dom) figureDOM(this, dom);
    return false;
  }

  getId(): string {
    return this.__id;
  }

  getTextContent(
    _includeInert?: boolean | undefined,
    _includeDirectionless?: false | undefined,
  ): string {
    return `https://www.youtube.com/watch?v=${this.__id}`;
  }

  static $createYouTubeNode<T extends YouTubeNode>(
    this: Klass<T>,
    videoID: string,
    width?: number,
    height?: number,
  ): T {
    const node = $create(this);
    node.__id = videoID;
    node.__width = width || "inherit";
    node.__height = height || "inherit";
    return node;
  }

  static $isYouTubeNode<T extends YouTubeNode>(
    this: Klass<T>,

    node: YouTubeNode | LexicalNode | null | undefined,
  ): node is T {
    return node instanceof YouTubeNode;
  }

  setWidthAndHeight(
    width: "inherit" | number,
    height: "inherit" | number,
  ): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  getWidth(): "inherit" | number {
    return this.__width;
  }

  getHeight(): "inherit" | number {
    return this.__height;
  }
}
