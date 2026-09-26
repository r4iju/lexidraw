import {
  $create,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type Klass,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  nodeSchema,
  type SerializedLexicalNode,
  type Spread,
  withField,
} from "lexical";
import { rawValueOr, type SchemaJSON } from "../schema-values.js";
import { withoutNodeState } from "../stored-order.js";

export type SerializedEquationNode = Spread<
  { equation: string; inline: boolean },
  SerializedLexicalNode
>;

function $convertEquationElement(
  domNode: HTMLElement,
): null | DOMConversionOutput {
  let equation = domNode.getAttribute("data-lexical-equation");
  const inline = domNode.getAttribute("data-lexical-inline") === "true";
  // Decode the equation from base64
  equation = atob(equation || "");
  if (equation) {
    const node = EquationNode.$createEquationNode(equation, inline);
    return { node };
  }

  return null;
}

const equationFields = {
  equation: withField(rawValueOr(""), { field: "__equation" }),
  inline: withField(rawValueOr(false), { field: "__inline" }),
};

/** @internal What {@link equationFields} write, which {@link SerializedEquationNode} is checked against. */
export type EquationFieldsJSON = SchemaJSON<typeof equationFields>;

const equationSchema = nodeSchema<EquationNode>()(equationFields);

/**
 * The editor's subclass renders the equation with KaTeX in `exportDOM`;
 * here the exported element only carries the source so the package has no
 * KaTeX dependency.
 */
export class EquationNode extends DecoratorNode<unknown> {
  __equation: string;
  __inline: boolean;

  $config() {
    return this.config("equation", {
      extends: DecoratorNode,
      json: equationSchema,
    });
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }

  constructor(equation = "", inline?: boolean, key?: NodeKey) {
    super(key);
    this.__equation = equation;
    this.__inline = inline ?? false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement(this.__inline ? "span" : "div");
    // EquationNodes should implement `user-action:none` in their CSS to avoid issues with deletion on Android.
    element.className = "editor-equation";
    return element;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.__inline ? "span" : "div");
    // Encode the equation as base64 to avoid issues with special characters
    const equation = btoa(this.__equation);
    element.setAttribute("data-lexical-equation", equation);
    element.setAttribute("data-lexical-inline", `${this.__inline}`);
    element.textContent = this.__equation;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-equation")) {
          return null;
        }
        return {
          conversion: $convertEquationElement,
          priority: 2,
        };
      },
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-equation")) {
          return null;
        }
        return {
          conversion: $convertEquationElement,
          priority: 1,
        };
      },
    };
  }

  updateDOM(prevNode: EquationNode): boolean {
    // If the inline property changes, replace the element
    return this.__inline !== prevNode.__inline;
  }

  isInline(): boolean {
    return this.__inline;
  }

  getTextContent(): string {
    return this.__equation;
  }

  getEquation(): string {
    return this.__equation;
  }

  setEquation(equation: string): void {
    const writable = this.getWritable();
    writable.__equation = equation;
  }

  static $createEquationNode<T extends EquationNode>(
    this: Klass<T>,
    equation = "",
    inline = false,
  ): T {
    const node = $create(this);
    node.__equation = equation;
    node.__inline = inline;
    return node;
  }

  static $isEquationNode<T extends EquationNode>(
    this: Klass<T>,

    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof EquationNode;
  }
}
