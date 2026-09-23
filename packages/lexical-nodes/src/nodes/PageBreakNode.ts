import {
  $create,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Klass,
} from "lexical";

export type SerializedPageBreakNode = SerializedLexicalNode;

export class PageBreakNode extends DecoratorNode<unknown> {
  static getType(): string {
    return "page-break";
  }

  static clone(node: PageBreakNode): PageBreakNode {
    return new this(node.__key);
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  static importJSON(_serializedNode: SerializedPageBreakNode): PageBreakNode {
    return PageBreakNode.$createPageBreakNode();
  }

  static importDOM(): DOMConversionMap | null {
    return {
      figure: (domNode: HTMLElement) => {
        const tp = domNode.getAttribute("type");
        if (tp !== PageBreakNode.getType()) {
          return null;
        }

        return {
          conversion: PageBreakNode.$convertPageBreakElement,
          priority: COMMAND_PRIORITY_HIGH,
        };
      },
    };
  }

  exportJSON(): SerializedLexicalNode {
    return {
      type: this.getType(),
      version: 1,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("figure");
    el.style.pageBreakAfter = "always";
    el.setAttribute("type", this.getType());
    return el;
  }

  getTextContent(): string {
    return "\n";
  }

  isInline(): false {
    return false;
  }

  updateDOM(): boolean {
    return false;
  }

  static $convertPageBreakElement(): DOMConversionOutput {
    return { node: PageBreakNode.$createPageBreakNode() };
  }

  static $createPageBreakNode<T extends PageBreakNode>(this: Klass<T>): T {
    return $create(this);
  }

  static $isPageBreakNode<T extends PageBreakNode>(
    this: Klass<T>,

    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof PageBreakNode;
  }
}
