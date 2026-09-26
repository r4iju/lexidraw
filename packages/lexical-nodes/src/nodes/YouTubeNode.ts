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
  type Spread,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { figureDOM, figureState } from "../figure.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";
import { storedBlockFields } from "./stored-block.js";
import {
  type Size,
  type StoredSizeAccessors,
  storedSizeFields,
  withStoredSize,
} from "./stored-size.js";

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

const { fields: youTubeFields, json: youTubeJSON } = storedFields({
  ...storedBlockFields,
  type: written,
  version: written,
  $: written,
  videoID: withField(storedValue<string>(), { field: "__id" }),
  ...storedSizeFields,
});

export type SerializedYouTubeNode = Spread<
  SchemaJSON<typeof youTubeJSON>,
  SerializedDecoratorBlockNode
>;

const youTubeSchema = nodeSchema<YouTubeNode>()(youTubeFields);

export interface YouTubeNode extends StoredSizeAccessors {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: withStoredSize installs the accessors the interface declares.
export class YouTubeNode extends DecoratorBlockNode {
  declare static importJSON: ImportJSON<YouTubeNode>;
  __id: string;
  __width: Size;
  __height: Size;

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

withStoredSize(YouTubeNode);

withStoredJSON(YouTubeNode);
