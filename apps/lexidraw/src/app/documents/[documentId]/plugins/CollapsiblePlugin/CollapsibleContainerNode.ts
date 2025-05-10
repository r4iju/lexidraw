import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementNode,
  isHTMLElement,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from "lexical";

import { IS_CHROME } from "@lexical/utils";
import invariant from "../../shared/invariant";

type SerializedCollapsibleContainerNode = Spread<
  {
    open: boolean;
  },
  SerializedElementNode
>;

export function $convertDetailsElement(
  domNode: HTMLDetailsElement,
): DOMConversionOutput | null {
  const isOpen = domNode.open !== undefined ? domNode.open : true;
  const node = CollapsibleContainerNode.$createCollapsibleContainerNode(isOpen);
  return {
    node,
  };
}

export class CollapsibleContainerNode extends ElementNode {
  __open: boolean;

  constructor(open: boolean, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  static getType(): string {
    return "collapsible-container";
  }

  static clone(node: CollapsibleContainerNode): CollapsibleContainerNode {
    return new CollapsibleContainerNode(node.__open, node.__key);
  }

  static $isCollapsibleContainerNode(
    node: LexicalNode | null | undefined,
  ): node is CollapsibleContainerNode {
    return node instanceof CollapsibleContainerNode;
  }

  private setDomHiddenUntilFound(dom: HTMLElement): void {
    // @ts-expect-error it's probably fine
    dom.hidden = "until-found";
  }

  private domOnBeforeMatch(dom: HTMLElement, callback: () => void): void {
    // @ts-expect-error it's probably fine
    dom.onbeforematch = callback;
  }
  createDOM(config: EditorConfig, editor: LexicalEditor): HTMLElement {
    let dom: HTMLElement;
    if (IS_CHROME) {
      dom = document.createElement("div");
      dom.setAttribute("open", "");
    } else {
      const detailsDom = document.createElement("details");
      detailsDom.open = this.__open;
      detailsDom.addEventListener("toggle", () => {
        const open = editor.getEditorState().read(() => this.getOpen());
        if (open !== detailsDom.open) {
          editor.update(() => this.toggleOpen());
        }
      });
      dom = detailsDom;
    }
    dom.classList.add("bg-card", "border", "border-border", "rounded-sm");

    return dom;
  }

  updateDOM(prevNode: CollapsibleContainerNode, dom: HTMLElement): boolean {
    const currentOpen = this.__open;
    const contentDom = dom.children[1] as HTMLElement; // Assuming content is the second child

    if (prevNode.__open !== currentOpen) {
      // Update icon rotation in summary
      const summaryElement = dom.firstChild as HTMLElement;
      if (summaryElement && summaryElement.tagName === "SUMMARY") {
        const iconElement = summaryElement.firstChild as HTMLElement;
        if (iconElement && iconElement.tagName === "SPAN") {
          if (currentOpen) {
            iconElement.classList.add("rotate-90");
          } else {
            iconElement.classList.remove("rotate-90");
          }
        }
      }

      // Handle content animation
      if (contentDom) {
        if (currentOpen) {
          // Opening
          if (IS_CHROME) {
            contentDom.hidden = false;
          }
          contentDom.classList.remove("animate-accordion-up", "h-0");
          contentDom.classList.add("animate-accordion-down");
        } else {
          // Closing
          contentDom.classList.remove("animate-accordion-down");
          contentDom.classList.add("animate-accordion-up");
          // The animation should take care of setting height to 0.
          // If IS_CHROME, and we needed to set hidden after animation, that would be complex here.
          // Relying on h-0 from animation and overflow-hidden for now.
        }
      }

      // Original logic for details/div open attribute
      if (IS_CHROME) {
        // const contentDom = dom.children[1]; // Already got contentDom
        invariant(
          isHTMLElement(contentDom as Element),
          "Expected contentDom to be an HTMLElement",
        );
        if (currentOpen) {
          dom.setAttribute("open", "");
          // contentDom.hidden = false; // Done above
        } else {
          dom.removeAttribute("open");
          // For Chrome, if not animating to h-0 reliably, we might need this after a delay:
          // this.setDomHiddenUntilFound(contentDom as HTMLElement);
        }
      } else {
        if (dom instanceof HTMLDetailsElement) {
          dom.open = this.__open;
        }
      }
    }
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLDetailsElement> | null {
    return {
      details: (_domNode: HTMLDetailsElement) => {
        return {
          conversion: $convertDetailsElement,
          priority: 1,
        };
      },
    };
  }

  static $createCollapsibleContainerNode(
    isOpen: boolean,
  ): CollapsibleContainerNode {
    return new CollapsibleContainerNode(isOpen);
  }

  static importJSON(
    serializedNode: SerializedCollapsibleContainerNode,
  ): CollapsibleContainerNode {
    const node = CollapsibleContainerNode.$createCollapsibleContainerNode(
      serializedNode.open,
    );
    return node;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("details");
    element.classList.add("bg-card", "border", "border-border", "rounded-sm");
    element.setAttribute("open", this.__open.toString());
    return { element };
  }

  exportJSON(): SerializedCollapsibleContainerNode {
    return {
      ...super.exportJSON(),
      open: this.__open,
      type: "collapsible-container",
      version: 1,
    };
  }

  setOpen(open: boolean): void {
    const writable = this.getWritable();
    writable.__open = open;
  }

  getOpen(): boolean {
    return this.getLatest().__open;
  }

  toggleOpen(): void {
    this.setOpen(!this.getOpen());
  }
}
