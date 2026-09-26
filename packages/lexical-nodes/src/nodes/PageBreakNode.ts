import {
  $create,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type LexicalNode,
  nodeSchema,
  type SerializedLexicalNode,
  type Klass,
} from "lexical";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";

export type SerializedPageBreakNode = SerializedLexicalNode;

const { fields: pageBreakFields } = storedFields({
  type: written,
  version: written,
});

const pageBreakSchema = nodeSchema<PageBreakNode>()(pageBreakFields);

export class PageBreakNode extends DecoratorNode<unknown> {
  declare static importJSON: ImportJSON<PageBreakNode>;

  $config() {
    return this.config("page-break", {
      extends: DecoratorNode,
      json: pageBreakSchema,
    });
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

withStoredJSON(PageBreakNode);
