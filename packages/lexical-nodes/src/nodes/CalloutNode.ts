import {
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type ElementDOMSlot,
  ElementNode,
  enumValue,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type SerializedElementNode,
  type Spread,
  stringValue,
  withField,
} from "lexical";

/** GitHub's five alert kinds, the only ones a callout stores. */
export const CALLOUT_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

export const isCalloutKind = (value: unknown): value is CalloutKind =>
  CALLOUT_KINDS.includes(value as CalloutKind);

export type SerializedCalloutNode = Spread<
  { kind: CalloutKind; title: string },
  SerializedElementNode
>;

/**
 * The header is the node's own chrome, drawn beside the children rather than
 * among them, so the children go into the body element.
 */
function calloutDOM(kind: CalloutKind, title: string) {
  const root = document.createElement("div");
  root.className = "callout";
  root.setAttribute("role", "note");
  root.dataset.calloutKind = kind;
  const header = document.createElement("div");
  header.className = "callout-header";
  header.contentEditable = "false";
  const icon = document.createElement("span");
  icon.className = "callout-icon";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "callout-title";
  label.textContent = title || CALLOUT_LABELS[kind];
  header.append(icon, label);
  const body = document.createElement("div");
  body.className = "callout-body";
  root.append(header, body);
  return { root, header, label, body };
}

function $convertCalloutElement(domNode: HTMLElement): DOMConversionOutput {
  const kind = domNode.dataset.calloutKind;
  const title =
    domNode.querySelector(":scope > .callout-header .callout-title")
      ?.textContent ?? "";
  const resolved = isCalloutKind(kind) ? kind : "note";
  return {
    node: CalloutNode.$createCalloutNode(
      resolved,
      title === CALLOUT_LABELS[resolved] ? "" : title,
    ),
  };
}

const calloutSchema = nodeSchema<CalloutNode>()({
  kind: withField(enumValue(CALLOUT_KINDS), { field: "__kind" }),
  title: withField(stringValue(), { field: "__title" }),
});

export class CalloutNode extends ElementNode {
  __kind: CalloutKind;
  __title: string;

  constructor(kind: CalloutKind = "note", title = "", key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__title = title;
  }

  $config() {
    return this.config("callout", {
      extends: ElementNode,
      json: calloutSchema,
    });
  }

  createDOM(): HTMLElement {
    return calloutDOM(this.__kind, this.__title).root;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    const body = element.querySelector<HTMLElement>(":scope > .callout-body");
    return super.getDOMSlot(element).withElement(body ?? element);
  }

  updateDOM(prevNode: CalloutNode, dom: HTMLElement): boolean {
    if (prevNode.__kind !== this.__kind || prevNode.__title !== this.__title) {
      dom.dataset.calloutKind = this.__kind;
      const label = dom.querySelector(
        ":scope > .callout-header .callout-title",
      );
      if (label)
        label.textContent = this.__title || CALLOUT_LABELS[this.__kind];
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const { root, header, body } = calloutDOM(this.__kind, this.__title);
    header.removeAttribute("contenteditable");
    return { element: root, append: (child) => body.append(child) };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) =>
        domNode.classList.contains("callout") &&
        domNode.dataset.calloutKind !== undefined
          ? { conversion: $convertCalloutElement, priority: 2 }
          : null,
    };
  }

  isShadowRoot(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  getKind(): CalloutKind {
    return this.getLatest().__kind;
  }

  setKind(kind: CalloutKind): this {
    const writable = this.getWritable();
    writable.__kind = kind;
    return writable;
  }

  getTitle(): string {
    return this.getLatest().__title;
  }

  setTitle(title: string): this {
    const writable = this.getWritable();
    writable.__title = title;
    return writable;
  }

  static $createCalloutNode(
    kind: CalloutKind = "note",
    title = "",
  ): CalloutNode {
    return new CalloutNode(kind, title);
  }

  static $isCalloutNode(
    node: LexicalNode | null | undefined,
  ): node is CalloutNode {
    return node instanceof CalloutNode;
  }
}
