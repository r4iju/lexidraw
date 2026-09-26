import {
  booleanValue,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  withField,
} from "lexical";

/**
 * How a section's content folds and unfolds. It is added the first time the
 * section is opened or closed by hand: on a section drawn for the first time,
 * the closing animation would play from its full height (and the opening one
 * from none), painting a closed section open and then folding it, which moves
 * everything below it.
 */
const SECTION_MOTION = [
  "data-[state=open]:animate-accordion-down",
  "data-[state=closed]:animate-accordion-up",
];

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

const collapsibleContainerSchema = nodeSchema<CollapsibleContainerNode>()({
  open: withField(booleanValue(), { field: "__open" }),
});

export class CollapsibleContainerNode extends ElementNode {
  __open: boolean;

  constructor(open = false, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  $config() {
    return this.config("collapsible-container", {
      extends: ElementNode,
      json: collapsibleContainerSchema,
    });
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

  /**
   * Keeps the trigger and content in step with `__open`. A section `toggled`
   * by hand folds or unfolds; one showing for the first time is drawn in its
   * state, with nothing to animate from.
   */
  private syncChildState(dom: HTMLElement, toggled: boolean) {
    const trigger = dom.querySelector<HTMLElement>(
      "[data-slot='accordion-trigger']",
    );
    const content = dom.querySelector<HTMLElement>(
      "[data-slot='accordion-content']",
    );
    const stateStr = this.__open ? "open" : "closed";

    if (trigger) trigger.dataset.state = stateStr;
    if (!content) return;

    // Always set the CSS var first for proper animation support
    const fullHeight = content.scrollHeight;
    content.style.setProperty(
      "--radix-accordion-content-height",
      `${fullHeight}px`,
    );

    if (this.__open) {
      // remove the inline height that was added when we closed last time
      content.style.removeProperty("height");
    } else {
      // Set height to 0 immediately for closed state (before animation)
      content.style.height = "0";
    }

    if (toggled) content.classList.add(...SECTION_MOTION);
    // Set data-state after height is configured to ensure proper animation
    content.dataset.state = stateStr;
  }

  updateDOM(prev: this, dom: HTMLElement) {
    if (prev.__open !== this.__open) {
      dom.dataset.state = this.__open ? "open" : "closed";
      this.syncChildState(dom, true);
    }
    // Ensure child state is synced after children are first mounted by Lexical
    // This might be better handled after initial render if children are not immediately available
    if (dom.dataset.lexicalInitialRender === undefined) {
      this.syncChildState(dom, false);
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

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.dataset.slot = "accordion-item";
    element.dataset.state = this.__open ? "open" : "closed";
    element.className = "border border-border";
    return { element };
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
