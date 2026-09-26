import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type LexicalParseJSON,
  nodeSchema,
  type SerializedLexicalNode,
} from "lexical";
import { withoutNodeState } from "../stored-order.js";
import { CollapsibleContainerNode } from "./CollapsibleContainerNode.js";
import { unreadElementFields } from "./stored-element.js";

export function $convertAccordionContentElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  return domNode.dataset.slot === "accordion-content"
    ? { node: CollapsibleContentNode.$createCollapsibleContentNode() }
    : null;
}

export class CollapsibleContentNode extends ElementNode {
  $config() {
    return this.config("collapsible-content", {
      extends: ElementNode,
      json: nodeSchema<CollapsibleContentNode>()(unreadElementFields),
    });
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    let isOpen = false; // Default to closed to avoid visual mismatch
    editor.getEditorState().read(() => {
      const parent = this.getParentOrThrow();
      if (CollapsibleContainerNode.$isCollapsibleContainerNode(parent)) {
        isOpen = parent.getOpen();
      }
    });

    const outer = document.createElement("div");
    outer.dataset.slot = "accordion-content";
    outer.dataset.state = isOpen ? "open" : "closed"; // Initial state
    // Drawn in its state; it animates once toggled, see `SECTION_MOTION`.
    outer.className = "overflow-hidden text-base";

    // If closed, set height to 0 immediately to prevent visual expansion
    if (!isOpen) {
      outer.style.height = "0";
    }

    return outer;
  }

  updateDOM(
    _prevNode: CollapsibleContentNode,
    _dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (domNode.dataset.slot === "accordion-content") {
          return {
            conversion: $convertAccordionContentElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.dataset.slot = "accordion-content";
    // The parent CollapsibleContainerNode is responsible for the data-state attribute that drives animation.
    // This node just needs its base classes.
    element.className = "overflow-hidden text-base pt-0 pb-4";
    // The animate-accordion-down/up classes are applied based on data-state, set by parent container.
    // So we don't need to explicitly add them here if state is unknown.
    return { element };
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
