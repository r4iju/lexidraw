import {
  DOMConversionMap,
  DOMConversionOutput,
  EditorConfig,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  RangeSelection,
  SerializedElementNode,
} from "lexical";
import { CollapsibleContainerNode } from "./CollapsibleContainerNode";
import ReactDOMServer from "react-dom/server";
import { ChevronRight } from "lucide-react";

type SerializedCollapsibleTitleNode = SerializedElementNode;

export function $convertAccordionTriggerElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  return domNode.dataset.slot === "accordion-trigger"
    ? { node: CollapsibleTitleNode.$createCollapsibleTitleNode() }
    : null;
}

export class CollapsibleTitleNode extends ElementNode {
  static getType(): string {
    return "collapsible-title";
  }

  static clone(node: CollapsibleTitleNode): CollapsibleTitleNode {
    return new CollapsibleTitleNode(node.__key);
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    let isOpen = true;
    editor.getEditorState().read(() => {
      const parent = this.getParentOrThrow();
      if (CollapsibleContainerNode.$isCollapsibleContainerNode(parent)) {
        isOpen = parent.getOpen();
      }
    });

    const button = document.createElement("button");
    button.dataset.slot = "accordion-trigger";
    button.dataset.state = isOpen ? "open" : "closed";
    button.className = [
      "flex flex-1 flex-row items-center gap-2 w-full py-1 min-h-10",
      "text-left text-sm font-medium",
      "transition-all ease-in-out",
      "outline-none cursor-pointer",
      "disabled:pointer-events-none disabled:opacity-50",
      "[&[data-state=open]>svg]:rotate-90",
    ].join(" ");

    button.innerHTML = ReactDOMServer.renderToStaticMarkup(
      <ChevronRight className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0 transition-transform " />,
    );

    button.addEventListener("click", (e) => {
      e.preventDefault();
      editor.update(() => {
        const container = this.getLatest().getParentOrThrow();
        if (!CollapsibleContainerNode.$isCollapsibleContainerNode(container))
          return;

        container.toggleOpen();
        // move caret to end of title
        this.getLatest().selectEnd();
      });
    });

    return button;
  }

  updateDOM() {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      button: (domNode: HTMLElement) => {
        // Changed from summary to button
        if (domNode.dataset.slot === "accordion-trigger") {
          return {
            conversion: $convertAccordionTriggerElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(
    _serializedNode: SerializedCollapsibleTitleNode,
  ): CollapsibleTitleNode {
    return CollapsibleTitleNode.$createCollapsibleTitleNode();
  }

  exportJSON(): SerializedCollapsibleTitleNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-title",
      version: 1,
    };
  }

  static $isCollapsibleTitleNode(
    node: LexicalNode | null | undefined,
  ): node is CollapsibleTitleNode {
    return node instanceof CollapsibleTitleNode;
  }

  static $createCollapsibleTitleNode(): CollapsibleTitleNode {
    return new CollapsibleTitleNode();
  }

  collapseAtStart(_selection: RangeSelection): boolean {
    this.getParentOrThrow().insertBefore(this);
    return true;
  }
}
