import { addClassNamesToElement } from "@lexical/utils";
import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  ElementNode,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type SerializedElementNode,
  type Spread,
  stringValue,
  withField,
} from "lexical";
import { figureDOM, figureState } from "../figure.js";

export type SerializedLayoutContainerNode = Spread<
  {
    templateColumns: string;
  },
  SerializedElementNode
>;

function $convertLayoutContainerElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  const styleAttributes = window.getComputedStyle(domNode);
  const templateColumns = styleAttributes.getPropertyValue(
    "grid-template-columns",
  );
  if (templateColumns) {
    const node =
      LayoutContainerNode.$createLayoutContainerNode(templateColumns);
    return { node };
  }
  return null;
}

const layoutContainerSchema = nodeSchema<LayoutContainerNode>()({
  templateColumns: withField(stringValue(), { field: "__templateColumns" }),
});

export class LayoutContainerNode extends ElementNode {
  __templateColumns: string;

  constructor(templateColumns = "", key?: NodeKey) {
    super(key);
    this.__templateColumns = templateColumns;
  }

  $config() {
    return this.config("layout-container", {
      extends: ElementNode,
      json: layoutContainerSchema,
      stateConfigs: [figureState],
    });
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement("div");
    dom.setAttribute("data-lexical-layout-container", "true");
    dom.style.gridTemplateColumns = this.__templateColumns;
    if (typeof config.theme.layoutContainer === "string") {
      addClassNamesToElement(dom, config.theme.layoutContainer);
    }
    figureDOM(this, dom);
    return dom;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.style.gridTemplateColumns = this.__templateColumns;
    element.setAttribute("data-lexical-layout-container", "true");
    return { element };
  }

  updateDOM(prevNode: LayoutContainerNode, dom: HTMLElement): boolean {
    if (prevNode.__templateColumns !== this.__templateColumns) {
      dom.style.gridTemplateColumns = this.__templateColumns;
    }
    figureDOM(this, dom);
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-layout-container")) {
          return null;
        }
        return {
          conversion: $convertLayoutContainerElement,
          priority: 2,
        };
      },
    };
  }

  isShadowRoot(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  getTemplateColumns(): string {
    return this.getLatest().__templateColumns;
  }

  setTemplateColumns(templateColumns: string) {
    this.getWritable().__templateColumns = templateColumns;
  }

  static $createLayoutContainerNode(
    templateColumns: string,
  ): LayoutContainerNode {
    return new LayoutContainerNode(templateColumns);
  }

  static $isLayoutContainerNode(
    node: LexicalNode | null | undefined,
  ): node is LayoutContainerNode {
    return node instanceof LayoutContainerNode;
  }
}
