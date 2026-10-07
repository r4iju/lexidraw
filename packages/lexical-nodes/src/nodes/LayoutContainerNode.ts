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
import { writtenElementFields } from "./stored-element.js";

/**
 * Columns as the editor writes them to HTML: the template from the inline
 * style, which a pasted fragment has without being laid out, or else an
 * equal share for each column.
 */
function $convertLayoutContainerElement(
  domNode: HTMLElement,
): DOMConversionOutput {
  const columns = Array.from(domNode.children).filter((child) =>
    child.hasAttribute("data-lexical-layout-item"),
  ).length;
  const templateColumns =
    domNode.style.gridTemplateColumns.trim() ||
    Array.from({ length: Math.max(columns, 2) }, () => "1fr").join(" ");
  return {
    node: LayoutContainerNode.$createLayoutContainerNode(templateColumns),
  };
}

const { fields: layoutContainerFields, json: layoutContainerJSON } =
  storedFields({
    ...writtenElementFields,
    type: written,
    version: written,
    $: written,
    templateColumns: withField(storedValue<string>(), {
      field: "__templateColumns",
    }),
  });

export type SerializedLayoutContainerNode = Spread<
  SchemaJSON<typeof layoutContainerJSON>,
  SerializedElementNode
>;

const layoutContainerSchema = nodeSchema<LayoutContainerNode>()(
  layoutContainerFields,
);

export class LayoutContainerNode extends ElementNode {
  declare static importJSON: ImportJSON<LayoutContainerNode>;
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

withStoredJSON(LayoutContainerNode);
