import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";

// import { IS_CHROME } from "@lexical/utils"; // Unused
// import ReactDOMServer from "react-dom/server"; // Unused

type SerializedCollapsibleContainerNode = Spread<
  {
    open: boolean;
  },
  SerializedElementNode
>;

export function $convertAccordionItemElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  if (domNode.dataset.slot !== "accordion-item") return null;
  const isOpen = domNode.dataset.state !== "closed";
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

  createDOM(_config: EditorConfig, _editor: LexicalEditor): HTMLElement {
    const root = document.createElement("div"); // <Accordion.Item>
    root.dataset.slot = "accordion-item";
    root.dataset.state = this.__open ? "open" : "closed";
    root.className = "border border-border rounded-md px-4";
    // Children (summary, content) will be appended by Lexical reconciliation
    // We will call syncChildState in updateDOM and after initial append if needed.
    return root;
  }

  /** keep trigger & content in lock‑step with this.__open */
  private syncChildState(dom: HTMLElement) {
    const trigger = dom.querySelector<HTMLElement>(
      "[data-slot='accordion-trigger']",
    );
    const content = dom.querySelector<HTMLElement>(
      "[data-slot='accordion-content']",
    );
    const stateStr = this.__open ? "open" : "closed";

    if (trigger) trigger.dataset.state = stateStr;
    if (!content) return;

    // Inline height & CSS var — this is what Radix does internally
    const fullHeight = content.scrollHeight;
    content.style.setProperty(
      "--radix-accordion-content-height",
      `${fullHeight}px`,
    );

    if (this.__open) {
      content.style.setProperty(
        "--radix-accordion-content-height",
        `${fullHeight}px`,
      );
      // remove the inline height that was added when we closed last time
      content.style.removeProperty("height");
    } else {
      content.style.height = "0"; // kept for the close animation
    }

    content.dataset.state = stateStr;
  }

  updateDOM(prev: this, dom: HTMLElement) {
    if (prev.__open !== this.__open) {
      dom.dataset.state = this.__open ? "open" : "closed";
      this.syncChildState(dom);
    }
    // Ensure child state is synced after children are first mounted by Lexical
    // This might be better handled after initial render if children are not immediately available
    if (dom.dataset.lexicalInitialRender === undefined) {
      this.syncChildState(dom);
      dom.dataset.lexicalInitialRender = "done"; // Mark to avoid re-running excessively
    }
    return false; // DOM skeleton itself never changes
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      div: (domNode: HTMLElement) => {
        if (domNode.dataset.slot === "accordion-item") {
          return {
            conversion: $convertAccordionItemElement,
            priority: 1,
          };
        }
        return null;
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
    const element = document.createElement("div");
    element.dataset.slot = "accordion-item";
    element.dataset.state = this.__open ? "open" : "closed";
    element.className = "border border-border";
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
