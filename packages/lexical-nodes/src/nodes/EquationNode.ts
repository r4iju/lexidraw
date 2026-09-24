import type {
  Klass,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { $create, DecoratorNode } from "lexical";

export type SerializedEquationNode = Spread<
  {
    equation: string;
    inline: boolean;
  },
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

/**
 * The editor's subclass renders the equation with KaTeX in `exportDOM`;
 * here the exported element only carries the source so the package has no
 * KaTeX dependency.
 */
export class EquationNode extends DecoratorNode<unknown> {
  __equation: string;
  __inline: boolean;

  static getType(): string {
    return "equation";
  }

  static clone(node: EquationNode): EquationNode {
    return new this(node.__equation, node.__inline, node.__key);
  }

  constructor(equation = "", inline?: boolean, key?: NodeKey) {
    super(key);
    this.__equation = equation;
    this.__inline = inline ?? false;
  }

  static importJSON(serializedNode: SerializedEquationNode): EquationNode {
    return EquationNode.$createEquationNode(
      serializedNode.equation,
      serializedNode.inline,
    );
  }

  exportJSON(): SerializedEquationNode {
    return {
      equation: this.getEquation(),
      inline: this.__inline,
      type: "equation",
      version: 1,
    };
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
