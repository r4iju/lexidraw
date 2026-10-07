import {
  $getNodeByKey,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type ElementDOMSlot,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  withField,
} from "lexical";
import { storedValue } from "../schema-values.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";
import { unreadElementFields } from "./stored-element.js";

// lucide-react's ChevronRight rendered to static markup, inlined so this
// module has no React or icon dependency and loads outside the browser.
const CHEVRON_RIGHT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';

const CHEVRON = "[data-slot='accordion-chevron']";

/** The ids a toggle's chevron, title and content name each other by. */
export function toggleIds(key: NodeKey) {
  return { title: `toggle-title-${key}`, content: `toggle-content-${key}` };
}

export function $convertAccordionItemElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  const isOpen =
    domNode instanceof HTMLDetailsElement
      ? domNode.open
      : domNode.dataset.state !== "closed";
  return {
    node: CollapsibleContainerNode.$createCollapsibleContainerNode(isOpen),
  };
}

const { fields: collapsibleContainerFields } = storedFields({
  children: written,
  ...unreadElementFields,
  type: written,
  version: written,
  open: withField(storedValue<boolean>(), { field: "__open" }),
});

const collapsibleContainerSchema = nodeSchema<CollapsibleContainerNode>()(
  collapsibleContainerFields,
);

/**
 * A toggle: a title, always shown, and content that folds away under it.
 * The chevron that opens and closes it is the container's own, ahead of
 * the children Lexical manages, so editing the title never toggles it.
 */
export class CollapsibleContainerNode extends ElementNode {
  declare static importJSON: ImportJSON<CollapsibleContainerNode>;
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

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const key = this.__key;
    const ids = toggleIds(key);
    const root = document.createElement("div");
    root.dataset.slot = "accordion-item";
    root.dataset.state = this.__open ? "open" : "closed";

    const chevron = document.createElement("button");
    chevron.type = "button";
    chevron.contentEditable = "false";
    chevron.dataset.slot = "accordion-chevron";
    // Cmd/Ctrl+Enter toggles from the keyboard; Tab stays the editor's.
    chevron.tabIndex = -1;
    chevron.setAttribute("aria-expanded", String(this.__open));
    chevron.setAttribute("aria-controls", ids.content);
    chevron.setAttribute("aria-labelledby", ids.title);
    chevron.innerHTML = CHEVRON_RIGHT_SVG;
    // Keeps the caret, and the editor's focus, where they were.
    chevron.addEventListener("mousedown", (event) => event.preventDefault());
    chevron.addEventListener("click", (event) => {
      event.preventDefault();
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (CollapsibleContainerNode.$isCollapsibleContainerNode(node))
          node.toggleOpen();
      });
    });
    root.append(chevron);
    return root;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    return super
      .getDOMSlot(element)
      .withAfter(element.querySelector(`:scope > ${CHEVRON}`));
  }

  updateDOM(prev: this, dom: HTMLElement) {
    if (prev.__open !== this.__open) {
      const state = this.__open ? "open" : "closed";
      dom
        .querySelector(`:scope > ${CHEVRON}`)
        ?.setAttribute("aria-expanded", String(this.__open));
      const content = dom.querySelector<HTMLElement>(
        ":scope > [data-slot='accordion-content']",
      );
      // Folding runs between none and the content's full height, measured
      // before the state changes. A toggle drawn for the first time has no
      // motion: it is painted in its state, so nothing below it moves.
      if (content) {
        dom.style.setProperty(
          "--toggle-content-height",
          `${content.scrollHeight}px`,
        );
        dom.dataset.motion = "";
      }
      dom.dataset.state = state;
    }
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      details: () => ({
        conversion: $convertAccordionItemElement,
        priority: 1,
      }),
      div: (domNode: HTMLElement) =>
        domNode.dataset.slot === "accordion-item"
          ? { conversion: $convertAccordionItemElement, priority: 1 }
          : null,
    };
  }

  static $createCollapsibleContainerNode(
    isOpen: boolean,
  ): CollapsibleContainerNode {
    return new CollapsibleContainerNode(isOpen);
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("details");
    element.open = this.__open;
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

withStoredJSON(CollapsibleContainerNode);
