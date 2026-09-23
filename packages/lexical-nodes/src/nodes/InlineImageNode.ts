import { HashtagNode } from "@lexical/hashtag";
import { LinkNode } from "@lexical/link";
import type {
  Klass,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedEditor,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import {
  $create,
  createEditor,
  DecoratorNode,
  LineBreakNode,
  ParagraphNode,
  RootNode,
  TextNode,
} from "lexical";
import { EmojiNode } from "./EmojiNode.js";
import { KeywordNode } from "./KeywordNode.js";

export type Position = "left" | "right" | "full" | undefined;

export interface InlineImagePayload {
  altText: string;
  caption?: LexicalEditor;
  height?: number;
  maxWidth?: number;
  showCaption?: boolean;
  src: string;
  width?: number;
  position?: Position;
  captionsEnabled?: boolean;
}

export interface UpdateInlineImagePayload {
  altText?: string;
  showCaption?: boolean;
  position?: Position;
  width?: "inherit" | number;
  height?: "inherit" | number;
}

function $convertInlineImageElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLImageElement) {
    const { alt: altText, src, width, height } = domNode;
    const node = InlineImageNode.$createInlineImageNode({
      altText,
      height,
      src,
      width,
    });
    return { node };
  }
  return null;
}

export type SerializedInlineImageNode = Spread<
  {
    altText: string;
    caption: SerializedEditor;
    height?: number;
    showCaption: boolean;
    src: string;
    width?: number;
    position?: Position;
    captionsEnabled?: boolean;
  },
  SerializedLexicalNode
>;

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

export class InlineImageNode extends DecoratorNode<unknown> {
  __src: string;
  __altText: string;
  __width: "inherit" | number;
  __height: "inherit" | number;
  __showCaption: boolean;
  __caption: LexicalEditor;
  __position: Position;
  __captionsEnabled: boolean;

  static getType(): string {
    return "inline-image";
  }

  static clone(node: InlineImageNode): InlineImageNode {
    return new this(
      node.__src,
      node.__altText,
      node.__position,
      node.__width,
      node.__height,
      node.__showCaption,
      node.__caption,
      node.__captionsEnabled,
      node.__key,
    );
  }

  static importJSON(
    serializedNode: SerializedInlineImageNode,
  ): InlineImageNode {
    const {
      altText,
      height,
      width,
      caption,
      src,
      showCaption,
      position,
      captionsEnabled,
    } = serializedNode;
    const node = InlineImageNode.$createInlineImageNode({
      altText,
      height,
      position,
      showCaption,
      src,
      width,
      captionsEnabled,
    });
    const nestedEditor = node.__caption;
    const editorState = nestedEditor.parseEditorState(caption.editorState);
    if (!editorState.isEmpty()) {
      nestedEditor.setEditorState(editorState);
    }
    return node;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: (_node: Node) => ({
        conversion: $convertInlineImageElement,
        priority: 0,
      }),
    };
  }

  constructor(
    src = "",
    altText = "",
    position: Position = undefined,
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
    this.__width = width || "inherit";
    this.__height = height || "inherit";
    this.__showCaption = showCaption || false;
    this.__caption = caption || createCaptionEditor();
    this.__position = position;
    this.__captionsEnabled = captionsEnabled ?? true;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    element.setAttribute("alt", this.__altText);
    element.setAttribute("width", this.__width.toString());
    element.setAttribute("height", this.__height.toString());
    return { element };
  }

  exportJSON(): SerializedInlineImageNode {
    return {
      altText: this.getAltText(),
      caption: this.__caption.toJSON(),
      height: this.__height === "inherit" ? 0 : this.__height,
      position: this.__position,
      showCaption: this.__showCaption,
      src: this.getSrc(),
      type: "inline-image",
      captionsEnabled: this.__captionsEnabled,
      version: 1,
      width: this.__width === "inherit" ? 0 : this.__width,
    };
  }

  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }

  setAltText(altText: string): void {
    const writable = this.getWritable();
    writable.__altText = altText;
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

  getShowCaption(): boolean {
    return this.__showCaption;
  }

  setShowCaption(showCaption: boolean): void {
    const writable = this.getWritable();
    writable.__showCaption = showCaption;
  }

  getPosition(): Position {
    return this.__position;
  }

  setPosition(position: Position): void {
    const writable = this.getWritable();
    writable.__position = position;
  }

  update(payload: UpdateInlineImagePayload): void {
    const writable = this.getWritable();
    const { altText, showCaption, position, width, height } = payload;
    if (altText !== undefined) {
      writable.__altText = altText;
    }
    if (showCaption !== undefined) {
      writable.__showCaption = showCaption;
    }
    if (position !== undefined) {
      writable.__position = position;
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
    const className = `${config.theme.inlineImage} position-${this.__position}`;
    if (className !== undefined) {
      span.className = className;
    }
    return span;
  }

  updateDOM(
    prevNode: InlineImageNode,
    dom: HTMLElement,
    config: EditorConfig,
  ): false {
    const position = this.__position;
    if (position !== prevNode.__position) {
      const className = `${config.theme.inlineImage} position-${position}`;
      if (className !== undefined) {
        dom.className = className;
      }
    }
    return false;
  }

  static $createInlineImageNode<T extends InlineImageNode>(
    this: Klass<T>,
    {
      altText,
      position,
      height,
      src,
      width,
      showCaption,
      caption,
      captionsEnabled,
    }: InlineImagePayload,
  ): T {
    const node = $create(this);
    node.__src = src;
    node.__altText = altText;
    node.__position = position;
    node.__width = width || "inherit";
    node.__height = height || "inherit";
    node.__showCaption = showCaption || false;
    if (caption) {
      node.__caption = caption;
    }
    node.__captionsEnabled = captionsEnabled ?? true;
    return node;
  }

  static $isInlineImageNode<T extends InlineImageNode>(
    this: Klass<T>,

    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof InlineImageNode;
  }
}
