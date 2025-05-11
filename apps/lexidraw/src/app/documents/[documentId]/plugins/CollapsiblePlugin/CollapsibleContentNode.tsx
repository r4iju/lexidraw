import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  SerializedElementNode,
} from "lexical";

import { CollapsibleContainerNode } from "./CollapsibleContainerNode";
// import { IS_CHROME } from "@lexical/utils"; // No longer needed
// import invariant from "../../shared/invariant"; // No longer needed
// import ReactDOMServer from "react-dom/server"; // No longer needed

type SerializedCollapsibleContentNode = SerializedElementNode;

export function $convertAccordionContentElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  return domNode.dataset.slot === "accordion-content"
    ? { node: CollapsibleContentNode.$createCollapsibleContentNode() }
    : null;
}

export class CollapsibleContentNode extends ElementNode {
  static getType(): string {
    return "collapsible-content";
  }

  static clone(node: CollapsibleContentNode): CollapsibleContentNode {
    return new CollapsibleContentNode(node.__key);
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    let isOpen = true;
    editor.getEditorState().read(() => {
      const parent = this.getParentOrThrow();
      if (CollapsibleContainerNode.$isCollapsibleContainerNode(parent)) {
        isOpen = parent.getOpen();
      }
    });

    const outer = document.createElement("div");
    outer.dataset.slot = "accordion-content";
    outer.dataset.state = isOpen ? "open" : "closed"; // Initial state
    outer.className =
      "overflow-hidden text-sm " +
      "data-[state=open]:animate-accordion-down " +
      "data-[state=closed]:animate-accordion-up";

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
    element.className = "overflow-hidden text-sm pt-0 pb-4";
    // The animate-accordion-down/up classes are applied based on data-state, set by parent container.
    // So we don't need to explicitly add them here if state is unknown.
    return { element };
  }

  static importJSON(
    _serializedNode: SerializedCollapsibleContentNode,
  ): CollapsibleContentNode {
    return CollapsibleContentNode.$createCollapsibleContentNode();
  }

  isShadowRoot(): boolean {
    return true;
  }

  exportJSON(): SerializedCollapsibleContentNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-content",
      version: 1,
    };
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
