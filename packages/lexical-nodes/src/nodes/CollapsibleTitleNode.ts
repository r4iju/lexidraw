import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type EditorConfig,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { CollapsibleContainerNode } from "./CollapsibleContainerNode.js";

// lucide-react's ChevronRight rendered to static markup, inlined so this
// module has no React or icon dependency and loads outside the browser.
const CHEVRON_RIGHT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0 transition-transform" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';

export function $convertAccordionTriggerElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  return domNode.dataset.slot === "accordion-trigger"
    ? { node: CollapsibleTitleNode.$createCollapsibleTitleNode() }
    : null;
}

export class CollapsibleTitleNode extends ElementNode {
  $config() {
    return this.config("collapsible-title", { extends: ElementNode });
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    let isOpen = false; // Default to closed to avoid visual mismatch
    editor.getEditorState().read(() => {
      const parent = this.getParentOrThrow();
      if (CollapsibleContainerNode.$isCollapsibleContainerNode(parent)) {
        isOpen = parent.getOpen();
      }
    });

    const button = document.createElement("button");
    button.dataset.placeholder = "Section title";
    button.dataset.slot = "accordion-trigger";
    button.dataset.state = isOpen ? "open" : "closed";
    button.className = [
      "flex flex-1 flex-row items-center gap-2 w-full py-1 min-h-10",
      "text-left text-base font-medium",
      "transition-all ease-in-out",
      "outline-none cursor-pointer",
      "disabled:pointer-events-none disabled:opacity-50",
      "[&[data-state=open]>svg]:rotate-90",
    ].join(" ");

    button.innerHTML = CHEVRON_RIGHT_SVG;

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
