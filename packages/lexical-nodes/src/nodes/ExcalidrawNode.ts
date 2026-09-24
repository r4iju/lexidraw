import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  Klass,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { $create, DecoratorNode } from "lexical";

type Dimension = number | "inherit";

export type SerializedExcalidrawNode = Spread<
  {
    data: string;
    justInserted?: boolean;
    width: Dimension;
    height: Dimension;
  },
  SerializedLexicalNode
>;

/**
 * Serialization half of the excalidraw block; see ImageNode for the split.
 */
export class ExcalidrawNode extends DecoratorNode<unknown> {
  __data: string;
  /** Only an insertion opens the drawing modal, so clones never inherit it. */
  __justInserted?: boolean;
  __width: Dimension;
  __height: Dimension;

  static getType(): string {
    return "excalidraw";
  }

  static clone(node: ExcalidrawNode): ExcalidrawNode {
    return new this(
      node.__data,
      false,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedExcalidrawNode): ExcalidrawNode {
    const node = ExcalidrawNode.$createExcalidrawNode(false);
    node.__data = serializedNode.data ?? "[]";
    node.__width = serializedNode.width ?? "inherit";
    node.__height = serializedNode.height ?? "inherit";
    return node;
  }

  exportJSON(): SerializedExcalidrawNode {
    return {
      data: this.__data,
      height: this.__height,
      type: "excalidraw",
      version: 1,
      width: this.__width,
    };
  }

  constructor(
    data = "[]",
    justInserted = false,
    width: Dimension = "inherit",
    height: Dimension = "inherit",
    key?: NodeKey,
  ) {
    super(key);
    this.__data = data;
    this.__justInserted = justInserted;
    this.__width = width;
    this.__height = height;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.dataset.mediaType = "excalidraw";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute("data-lexical-excalidraw-json")) {
          return null;
        }
        return {
          conversion: ExcalidrawNode.$convertExcalidrawElement,
          priority: 1,
        };
      },
    };
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement("span");

    element.style.display = "inline-block";

    const content = editor.getElementByKey(this.getKey());
    if (content !== null) {
      const svg = content.querySelector("svg");
      if (svg !== null) {
        element.innerHTML = svg.outerHTML;
      }
    }

    element.style.width =
      this.__width === "inherit" ? "inherit" : `${this.__width}px`;
    element.style.height =
      this.__height === "inherit" ? "inherit" : `${this.__height}px`;

    element.setAttribute("data-lexical-excalidraw-json", this.__data);
    return { element };
  }

  setData(data: string): void {
    const self = this.getWritable();
    self.__data = data;
  }

  setWidth(width: Dimension): void {
    const self = this.getWritable();
    self.__width = width;
  }

  setHeight(height: Dimension): void {
    const self = this.getWritable();
    self.__height = height;
  }

  getWidth(): Dimension {
    return this.getLatest().__width;
  }

  getHeight(): Dimension {
    return this.getLatest().__height;
  }

  getData(): string {
    return this.getLatest().__data;
  }

  static $createExcalidrawNode<T extends ExcalidrawNode>(
    this: Klass<T>,
    justInserted = true,
  ): T {
    const node = $create(this);
    node.__justInserted = justInserted;
    return node;
  }

  static $isExcalidrawNode<T extends ExcalidrawNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof ExcalidrawNode;
  }

  static $convertExcalidrawElement(
    domNode: HTMLElement,
  ): DOMConversionOutput | null {
    const excalidrawData = domNode.getAttribute("data-lexical-excalidraw-json");
    const styleAttributes = window.getComputedStyle(domNode);
    const heightStr = styleAttributes.getPropertyValue("height");
    const widthStr = styleAttributes.getPropertyValue("width");
    const height =
      !heightStr || heightStr === "inherit"
        ? "inherit"
        : parseInt(heightStr, 10);
    const width =
      !widthStr || widthStr === "inherit" ? "inherit" : parseInt(widthStr, 10);

    if (excalidrawData) {
      const node = ExcalidrawNode.$createExcalidrawNode();
      node.__data = excalidrawData;
      node.__height = height;
      node.__width = width;
      return {
        node,
      };
    }
    return null;
  }
}
