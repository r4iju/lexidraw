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

export function $convertAccordionTriggerElement(
  _domNode: HTMLElement,
): DOMConversionOutput | null {
  return { node: CollapsibleTitleNode.$createCollapsibleTitleNode() };
}

/**
 * A toggle's title: one paragraph or heading, edited like any other. It is
 * a shadow root so that block shortcuts and the block menu make it a
 * heading in place; the toggle plugin keeps it to that one block.
 */
export class CollapsibleTitleNode extends ElementNode {
  declare static importJSON: ImportJSON<CollapsibleTitleNode>;

  $config() {
    return this.config("collapsible-title", {
      extends: ElementNode,
      json: nodeSchema<CollapsibleTitleNode>()(unreadElementOnlyFields),
    });
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.dataset.slot = "accordion-trigger";
    const parent = this.getParent();
    if (parent) element.id = toggleIds(parent.getKey()).title;
    return element;
  }

  updateDOM() {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    const trigger = (domNode: HTMLElement) =>
      domNode.dataset.slot === "accordion-trigger"
        ? { conversion: $convertAccordionTriggerElement, priority: 1 as const }
        : null;
    return {
      summary: () => ({
        conversion: $convertAccordionTriggerElement,
        priority: 1,
      }),
      // A copied toggle's title: a button before titles were blocks, a div since.
      button: trigger,
      div: trigger,
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement("summary") };
  }

  isShadowRoot(): boolean {
    return true;
  }

  static $isCollapsibleTitleNode(
    node: LexicalNode | null | undefined,
  ): node is CollapsibleTitleNode {
    return node instanceof CollapsibleTitleNode;
  }

  static $createCollapsibleTitleNode(): CollapsibleTitleNode {
    return new CollapsibleTitleNode();
  }
}

withStoredJSON(CollapsibleTitleNode);
