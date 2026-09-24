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

export class YouTubeNode extends DecoratorBlockNode {
  __id: string;
  __width: "inherit" | number;
  __height: "inherit" | number;

  static getType(): string {
    return "youtube";
  }

  static clone(node: YouTubeNode): YouTubeNode {
    return new this(
      node.__id,
      node.__width,
      node.__height,
      node.__format,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedYouTubeNode): YouTubeNode {
    const node = YouTubeNode.$createYouTubeNode(
      serializedNode.videoID,
      serializedNode.width,
      serializedNode.height,
    );
    node.setFormat(serializedNode.format);
    return $importNodeState(node, serializedNode);
  }

  exportJSON(): SerializedYouTubeNode {
    return {
      ...super.exportJSON(),
      type: "youtube",
      version: 1,
      videoID: this.__id,
      width: this.__width === "inherit" ? 0 : this.__width,
      height: this.__height === "inherit" ? 0 : this.__height,
    };
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
