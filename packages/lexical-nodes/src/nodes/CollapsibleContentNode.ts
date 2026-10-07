import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  ElementNode,
  type LexicalNode,
  nodeSchema,
} from "lexical";
import { type ImportJSON, withStoredJSON } from "../stored-fields.js";
import { toggleIds } from "./CollapsibleContainerNode.js";
import { unreadElementOnlyFields } from "./stored-element.js";

export function $convertAccordionContentElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  return domNode.dataset.slot === "accordion-content"
    ? { node: CollapsibleContentNode.$createCollapsibleContentNode() }
    : null;
}

/**
 * What a toggle folds away. Whether it shows is its container's state, which
 * the document's styles read; it holds no state of its own.
 */
export class CollapsibleContentNode extends ElementNode {
  declare static importJSON: ImportJSON<CollapsibleContentNode>;

  $config() {
    return this.config("collapsible-content", {
      extends: ElementNode,
      json: nodeSchema<CollapsibleContentNode>()(unreadElementOnlyFields),
    });
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.dataset.slot = "accordion-content";
    element.setAttribute("role", "region");
    const parent = this.getParent();
    if (parent) {
      const ids = toggleIds(parent.getKey());
      element.id = ids.content;
      element.setAttribute("aria-labelledby", ids.title);
    }
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) =>
        domNode.dataset.slot === "accordion-content"
          ? { conversion: $convertAccordionContentElement, priority: 1 }
          : null,
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement("div") };
  }

  isShadowRoot(): boolean {
    return true;
  }

  static $createCollapsibleContentNode(): CollapsibleContentNode {
    return new CollapsibleContentNode();
  }

  static $isCollapsibleContentNode(
    node: LexicalNode | null | undefined,
  ): node is CollapsibleContentNode {
    return node instanceof CollapsibleContentNode;
  }
}

withStoredJSON(CollapsibleContentNode);
