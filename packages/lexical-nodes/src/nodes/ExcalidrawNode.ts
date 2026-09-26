import {
  $create,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type SerializedLexicalNode,
  type Spread,
  withField,
} from "lexical";
import { figureDOM, figureState, naturalSizeState } from "../figure.js";
import { rawValueOr, type SchemaJSON } from "../schema-values.js";
import { inStoredOrder } from "../stored-order.js";
import { inheritOrStoredSize, type Size } from "./stored-size.js";

export type SerializedExcalidrawNode = Spread<
  { data: string; width: Size; height: Size },
  SerializedLexicalNode
>;

const excalidrawFields = {
  data: withField(rawValueOr("[]", { nullAsAbsent: true }), {
    field: "__data",
  }),
  width: withField(inheritOrStoredSize, { field: "__width" }),
  height: withField(inheritOrStoredSize, { field: "__height" }),
};

/** @internal What {@link excalidrawFields} write, which {@link SerializedExcalidrawNode} is checked against. */
export type ExcalidrawFieldsJSON = SchemaJSON<typeof excalidrawFields>;

const excalidrawSchema = nodeSchema<ExcalidrawNode>()(excalidrawFields);

/**
 * Serialization half of the excalidraw block; see ImageNode for the split.
 */
export class ExcalidrawNode extends DecoratorNode<unknown> {
  __data: string;
  /** Only an insertion opens the drawing modal, so clones never inherit it. */
  __justInserted?: boolean;
  __width: Size;
  __height: Size;

  $config() {
    return this.config("excalidraw", {
      extends: DecoratorNode,
      json: excalidrawSchema,
      stateConfigs: [figureState, naturalSizeState],
    });
  }

  constructor(
    data = "[]",
    justInserted = false,
    width: Size = "inherit",
    height: Size = "inherit",
    key?: NodeKey,
  ) {
    super(key);
    this.__data = data;
    this.__justInserted = justInserted;
    this.__width = width;
    this.__height = height;
  }

  exportJSON(): SerializedLexicalNode {
    return inStoredOrder(super.exportJSON(), ["type", "version", "width", "$"]);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.dataset.mediaType = "excalidraw";
    figureDOM(this, element);
    return element;
  }

  updateDOM(_prevNode: ExcalidrawNode, dom: HTMLElement): false {
    figureDOM(this, dom);
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

  setWidth(width: Size): void {
    const self = this.getWritable();
    self.__width = width;
  }

  setHeight(height: Size): void {
    const self = this.getWritable();
    self.__height = height;
  }

  getWidth(): Size {
    return this.getLatest().__width;
  }

  getHeight(): Size {
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
