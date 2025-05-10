import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedElementNode,
  Spread,
} from "lexical";

import { IS_CHROME } from "@lexical/utils";
import ReactDOMServer from "react-dom/server";

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

  createDOM(config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const isOpen = this.__open; // Current open state of the node

    let dom: HTMLElement;

    if (IS_CHROME) {
      const chromeJsx = (
        <div
          className="group bg-card border border-border rounded-sm"
          data-open={isOpen ? "" : undefined}
        >
          {/* Children (summary, content) will be appended by Lexical reconciliation */}
        </div>
      );
      const htmlString = ReactDOMServer.renderToStaticMarkup(chromeJsx);
      const temp = document.createElement("div");
      temp.innerHTML = htmlString;
      dom = temp.firstChild as HTMLElement;
      if (isOpen) {
        dom.setAttribute("open", ""); // Ensure attribute if initially open
      } else {
        dom.removeAttribute("open");
      }
    } else {
      const detailsJsx = (
        <details className="group bg-card border border-border rounded-sm"></details>
      );
      const htmlString = ReactDOMServer.renderToStaticMarkup(detailsJsx);
      const temp = document.createElement("div");
      temp.innerHTML = htmlString;
      const detailsDom = temp.firstChild as HTMLDetailsElement;
      detailsDom.open = isOpen;
      detailsDom.addEventListener("toggle", () => {
        editor.getEditorState().read(() => {
          if (this.getOpen() !== detailsDom.open) {
            editor.update(() => this.toggleOpen());
          }
        });
      });
      dom = detailsDom;
    }
    return dom;
  }

  updateDOM(prev: this, dom: HTMLElement) {
    if (prev.__open !== this.__open) {
      if (this.__open) dom.setAttribute("open", "");
      else dom.removeAttribute("open");
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
