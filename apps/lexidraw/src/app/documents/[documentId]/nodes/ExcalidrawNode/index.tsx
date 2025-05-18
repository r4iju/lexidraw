import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";

import { DecoratorNode } from "lexical";
import ExcalidrawComponent from "./ExcalidrawComponent";
import * as React from "react";
import { Suspense } from "react";

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

export class ExcalidrawNode extends DecoratorNode<React.JSX.Element> {
  __data: string;
  __justInserted?: boolean;
  __width: Dimension;
  __height: Dimension;

  static getType(): string {
    return "excalidraw";
  }

  static clone(node: ExcalidrawNode): ExcalidrawNode {
    return new ExcalidrawNode(
      node.__data,
      false,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedExcalidrawNode): ExcalidrawNode {
    return new ExcalidrawNode(
      serializedNode.data,
      false,
      serializedNode.width,
      serializedNode.height,
    );
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

  // View
  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    const theme = config.theme;
    const className = theme.image;

    span.style.width =
      this.__width === "inherit" ? "inherit" : `${this.__width}px`;
    span.style.height =
      this.__height === "inherit" ? "inherit" : `${this.__height}px`;

    if (className !== undefined) {
      span.className = className;
    }
    return span;
  }

  updateDOM(prev: ExcalidrawNode, dom: HTMLElement): boolean {
    if (this.__width !== prev.__width) {
      dom.style.width =
        this.__width === "inherit" ? "inherit" : `${this.__width}px`;
    }
    if (this.__height !== prev.__height) {
      dom.style.height =
        this.__height === "inherit" ? "inherit" : `${this.__height}px`;
    }
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

  // ——— getters ———————————————————————————————
  getWidth(): Dimension {
    return this.getLatest().__width;
  }

  getHeight(): Dimension {
    return this.getLatest().__height;
  }

  getData(): string {
    return this.getLatest().__data;
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <ExcalidrawComponent
          nodeKey={this.getKey()}
          data={this.__data}
          defaultOpen={this.__justInserted}
          width={this.__width}
          height={this.__height}
        />
      </Suspense>
    );
  }

  static $createExcalidrawNode(justInserted = true): ExcalidrawNode {
    return new ExcalidrawNode(undefined, justInserted);
  }

  static $isExcalidrawNode(node: LexicalNode | null): node is ExcalidrawNode {
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
