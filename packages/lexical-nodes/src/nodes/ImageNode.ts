import { HashtagNode } from "@lexical/hashtag";
import { LinkNode } from "@lexical/link";
import {
  $create,
  $getRoot,
  createEditor,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  LineBreakNode,
  type NodeKey,
  nodeSchema,
  ParagraphNode,
  RootNode,
  type SerializedEditor,
  type SerializedEditorState,
  type SerializedLexicalNode,
  type Spread,
  TextNode,
  withAccessors,
  withField,
} from "lexical";
import { figureDOM, figureState, naturalSizeState } from "../figure.js";
import {
  falseOrStored,
  type NestedEditorJSON,
  nestedEditorValue,
  rawValueOr,
  type SchemaJSON,
  setNestedEditorJSON,
  storedValue,
} from "../schema-values.js";
import { EmojiNode } from "./EmojiNode.js";
import { KeywordNode } from "./KeywordNode.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";
import {
  type Size,
  type StoredSizeAccessors,
  storedSizeFields,
  withStoredSize,
} from "./stored-size.js";

export interface ImagePayload {
  altText: string;
  caption?: LexicalEditor;
  height?: number | "inherit";
  maxWidth?: number;
  showCaption?: boolean;
  src: string;
  width?: number | "inherit";
  captionsEnabled?: boolean;
}

export interface UpdateImagePayload {
  altText?: string;
  showCaption?: boolean;
  width?: "inherit" | number;
  height?: "inherit" | number;
}

function createCaptionEditor(): LexicalEditor {
  return createEditor({
    nodes: [
      RootNode,
      TextNode,
      LineBreakNode,
      ParagraphNode,
      LinkNode,
      EmojiNode,
      HashtagNode,
      KeywordNode,
    ],
  });
}

const { fields: imageFields, json: imageJSON } = storedFields({
  altText: withField(storedValue<string>(), { field: "__altText" }),
  caption: withAccessors(nestedEditorValue(createCaptionEditor), {
    getter: "getCaptionJSON",
    setter: "setCaptionJSON",
  }),
  height: storedSizeFields.height,
  maxWidth: withField(rawValueOr(500), { field: "__maxWidth" }),
  showCaption: withField(falseOrStored, { field: "__showCaption" }),
  src: withField(storedValue<string>(), { field: "__src" }),
  type: written,
  version: written,
  width: storedSizeFields.width,
  $: written,
});

export type SerializedImageNode = Spread<
  SchemaJSON<typeof imageJSON>,
  SerializedLexicalNode
>;

const imageSchema = nodeSchema<ImageNode>()(imageFields);

export interface ImageNode extends StoredSizeAccessors {}

/**
 * Serialization half of the image block. The editor registers a subclass
 * that renders the React component; instances are made with `$create`, so
 * whichever class is registered for "image" is the one constructed.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: withStoredSize installs the accessors the interface declares.
export class ImageNode extends DecoratorNode<unknown> {
  declare static importJSON: ImportJSON<ImageNode>;
  __src: string;
  __altText: string;
  __width: Size;
  __height: Size;
  __maxWidth: number;
  __showCaption: boolean;
  __caption: LexicalEditor;
  __captionsEnabled: boolean;

  $config() {
    return this.config("image", {
      extends: DecoratorNode,
      json: imageSchema,
      stateConfigs: [figureState, naturalSizeState],
    });
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__src = prevNode.__src;
    this.__altText = prevNode.__altText;
    this.__width = prevNode.__width;
    this.__height = prevNode.__height;
    this.__maxWidth = prevNode.__maxWidth;
    this.__showCaption = prevNode.__showCaption;
    this.__caption = prevNode.__caption;
    this.__captionsEnabled = prevNode.__captionsEnabled;
  }

  static isGoogleDocCheckboxImg(img: HTMLImageElement): boolean {
    return (
      img.parentElement != null &&
      img.parentElement.tagName === "LI" &&
      img.previousSibling === null &&
      img.getAttribute("aria-roledescription") === "checkbox"
    );
  }

  static $convertImageElement(domNode: Node): null | DOMConversionOutput {
    const img = domNode as HTMLImageElement;
    if (
      img.src.startsWith("file:///") ||
      ImageNode.isGoogleDocCheckboxImg(img)
    ) {
      return null;
    }
    const { alt: altText, src, width, height } = img;
    const node = ImageNode.$createImageNode({ altText, height, src, width });
    return { node };
  }

  static $createImageNode<T extends ImageNode>(
    this: Klass<T>,
    {
      altText,
      height,
      maxWidth = 500,
      captionsEnabled,
      src,
      width,
      showCaption,
      caption,
    }: ImagePayload,
  ): T {
    const node = $create(this);
    node.__src = src;
    node.__altText = altText;
    node.__maxWidth = maxWidth;
    node.__width = width || "inherit";
    node.__height = height || "inherit";
    node.__showCaption = showCaption || false;
    if (caption) {
      node.__caption = caption;
    }
    node.__captionsEnabled = captionsEnabled || captionsEnabled === undefined;
    return node;
  }

  static $isImageNode<T extends ImageNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof ImageNode;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    element.setAttribute("alt", this.__altText);
    element.setAttribute("width", this.__width.toString());
    element.setAttribute("height", this.__height.toString());
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: (_node: Node) => ({
        conversion: ImageNode.$convertImageElement,
        priority: 0,
      }),
    };
  }

  constructor(
    src = "",
    altText = "",
    maxWidth = 500,
    width?: "inherit" | number,
    height?: "inherit" | number,
    showCaption?: boolean,
    caption?: LexicalEditor,
    captionsEnabled?: boolean,
    key?: NodeKey,
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__maxWidth = maxWidth;
    this.__width = width || "inherit";
    this.__height = height || "inherit";
    this.__showCaption = showCaption || false;
    this.__caption = caption || createCaptionEditor();
    this.__captionsEnabled = captionsEnabled || captionsEnabled === undefined;
  }

  getCaptionJSON(): SerializedEditor {
    return this.__caption.toJSON();
  }

  setCaptionJSON(caption: NestedEditorJSON): this {
    setNestedEditorJSON(this.__caption, caption);
    return this;
  }

  getWidth(): "inherit" | number {
    return this.__width;
  }

  getHeight(): "inherit" | number {
    return this.__height;
  }

  setWidthAndHeight(
    width: "inherit" | number,
    height: "inherit" | number,
  ): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  setShowCaption(showCaption: boolean): void {
    const writable = this.getWritable();
    writable.__showCaption = showCaption;
  }

  getShowCaption(): boolean {
    return this.__showCaption;
  }

  /** The caption as plain text, or "" when the image shows none. */
  getCaptionText(): string {
    if (!this.__showCaption) return "";
    return this.__caption
      .getEditorState()
      .read(() => $getRoot().getTextContent())
      .trim();
  }

  /** Shows `text` as the caption, or hides the caption when it is empty. */
  setCaptionText(text: string): void {
    const writable = this.getWritable();
    writable.__showCaption = text !== "";
    const paragraph = {
      children: text
        ? [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
              type: "text",
              version: 1,
            },
          ]
        : [],
      direction: null,
      format: "",
      indent: 0,
      textFormat: 0,
      textStyle: "",
      type: "paragraph",
      version: 1,
    };
    writable.__caption.setEditorState(
      writable.__caption.parseEditorState({
        root: {
          children: [paragraph],
          direction: null,
          format: "",
          indent: 0,
          type: "root",
          version: 1,
        },
      } as unknown as SerializedEditorState),
    );
  }

  update(payload: UpdateImagePayload): void {
    const writable = this.getWritable();
    const { altText, showCaption, width, height } = payload;
    if (altText !== undefined) {
      writable.__altText = altText;
    }
    if (showCaption !== undefined) {
      writable.__showCaption = showCaption;
    }
    if (width !== undefined) {
      writable.__width = width;
    }
    if (height !== undefined) {
      writable.__height = height;
    }
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    const theme = config.theme;
    const className = theme.image;
    if (className !== undefined) {
      span.className = className;
    }
    figureDOM(this, span);
    return span;
  }

  updateDOM(_prevNode: ImageNode, dom: HTMLElement): false {
    figureDOM(this, dom);
    return false;
  }

  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }
}

withStoredSize(ImageNode);

withStoredJSON(ImageNode);
