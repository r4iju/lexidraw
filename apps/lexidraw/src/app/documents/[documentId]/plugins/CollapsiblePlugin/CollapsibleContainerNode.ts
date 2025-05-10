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
    dom.classList.add("bg-card", "border", "border-border", "rounded-lg");

    return dom;
  }

  updateDOM(prevNode: CollapsibleContainerNode, dom: HTMLElement): boolean {
    const currentOpen = this.__open;
    if (prevNode.__open !== currentOpen) {
      // Update icon rotation in summary
      const summaryElement = dom.firstChild as HTMLElement;
      if (summaryElement && summaryElement.tagName === "SUMMARY") {
        const iconElement = summaryElement.firstChild as HTMLElement;
        // Check if it's our icon span (e.g., by checking for SVG content or a specific class if we add one)
        // For now, assuming it's the first child if it exists and is a SPAN.
        if (iconElement && iconElement.tagName === "SPAN") {
          if (currentOpen) {
            iconElement.classList.add("rotate-90");
          } else {
            iconElement.classList.remove("rotate-90");
          }
        }
      }

      // details is not well supported in Chrome #5582
      if (IS_CHROME) {
        const contentDom = dom.children[1];
        invariant(
          isHTMLElement(contentDom as Element),
          "Expected contentDom to be an HTMLElement",
        );
        if (currentOpen) {
          dom.setAttribute("open", "");
          // @ts-expect-error - its fine
          contentDom.hidden = false;
        } else {
          dom.removeAttribute("open");
          this.setDomHiddenUntilFound(contentDom as HTMLElement);
        }
      } else {
        // For non-Chrome, ensure the details element's open attribute matches the node state.
        // The toggle event on <details> should have already triggered the node state update.
        // This DOM update ensures visual consistency if the state was changed programmatically.
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
    element.classList.add("bg-card", "border", "border-border", "rounded-lg");
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
